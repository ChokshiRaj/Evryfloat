use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContentType {
    Text,
    Color,
    Url,
    Email,
    Code,
    Image,
    Files,
}

impl ContentType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ContentType::Text => "text",
            ContentType::Color => "color",
            ContentType::Url => "url",
            ContentType::Email => "email",
            ContentType::Code => "code",
            ContentType::Image => "image",
            ContentType::Files => "files",
        }
    }

    pub fn from_str_opt(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "color" => ContentType::Color,
            "url" => ContentType::Url,
            "email" => ContentType::Email,
            "code" => ContentType::Code,
            "image" => ContentType::Image,
            "files" => ContentType::Files,
            _ => ContentType::Text,
        }
    }
}

/// Normalizes color strings (#rgb, #rrggbb, #rrggbbaa, rgb(...), rgba(...), hsl(...)) to uppercase #RRGGBB
pub fn parse_and_normalize_color(input: &str) -> Option<String> {
    let s = input.trim();
    if s.is_empty() {
        return None;
    }

    // 1. Hex parsing
    if let Some(stripped) = s.strip_prefix('#') {
        let hex = stripped.trim();
        // #RGB
        if hex.len() == 3 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
            let r = hex.chars().nth(0)?;
            let g = hex.chars().nth(1)?;
            let b = hex.chars().nth(2)?;
            return Some(format!("#{r}{r}{g}{g}{b}{b}").to_uppercase());
        }
        // #RRGGBB
        if hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(format!("#{hex}").to_uppercase());
        }
        // #RRGGBBAA -> strip alpha to #RRGGBB
        if hex.len() == 8 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(format!("#{}", &hex[..6]).to_uppercase());
        }
    }

    // 2. rgb(r, g, b) or rgba(r, g, b, a)
    let lower = s.to_lowercase();
    if lower.starts_with("rgb(") || lower.starts_with("rgba(") {
        let start = lower.find('(')? + 1;
        let end = lower.rfind(')')?;
        let inner = &lower[start..end];
        let parts: Vec<&str> = inner.split([',', ' ']).filter(|p| !p.trim().is_empty()).collect();
        if parts.len() >= 3 {
            let r = parse_color_component(parts[0])?;
            let g = parse_color_component(parts[1])?;
            let b = parse_color_component(parts[2])?;
            return Some(format!("#{r:02X}{g:02X}{b:02X}"));
        }
    }

    // 3. hsl(h, s%, l%)
    if lower.starts_with("hsl(") || lower.starts_with("hsla(") {
        let start = lower.find('(')? + 1;
        let end = lower.rfind(')')?;
        let inner = &lower[start..end];
        let parts: Vec<&str> = inner.split([',', ' ']).filter(|p| !p.trim().is_empty()).collect();
        if parts.len() >= 3 {
            let h: f64 = parts[0].trim().trim_end_matches("deg").parse().ok()?;
            let s: f64 = parts[1].trim().trim_end_matches('%').parse::<f64>().ok()? / 100.0;
            let l: f64 = parts[2].trim().trim_end_matches('%').parse::<f64>().ok()? / 100.0;
            let (r, g, b) = hsl_to_rgb(h, s, l);
            return Some(format!("#{r:02X}{g:02X}{b:02X}"));
        }
    }

    None
}

fn parse_color_component(part: &str) -> Option<u8> {
    let p = part.trim();
    if let Some(pct) = p.strip_suffix('%') {
        let v: f64 = pct.parse().ok()?;
        return Some((v * 2.55).round().clamp(0.0, 255.0) as u8);
    }
    let v: f64 = p.parse().ok()?;
    Some(v.round().clamp(0.0, 255.0) as u8)
}

fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (u8, u8, u8) {
    let h = (h % 360.0 + 360.0) % 360.0;
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
    let m = l - c / 2.0;

    let (r_prime, g_prime, b_prime) = if h < 60.0 {
        (c, x, 0.0)
    } else if h < 120.0 {
        (x, c, 0.0)
    } else if h < 180.0 {
        (0.0, c, x)
    } else if h < 240.0 {
        (0.0, x, c)
    } else if h < 300.0 {
        (x, 0.0, c)
    } else {
        (c, 0.0, x)
    };

    (
        ((r_prime + m) * 255.0).round().clamp(0.0, 255.0) as u8,
        ((g_prime + m) * 255.0).round().clamp(0.0, 255.0) as u8,
        ((b_prime + m) * 255.0).round().clamp(0.0, 255.0) as u8,
    )
}

/// Detects content type based on heuristics
pub fn detect_content_type(text: &str, color_hex: &Option<String>) -> ContentType {
    if color_hex.is_some() {
        return ContentType::Color;
    }

    let t = text.trim();
    if t.starts_with("http://") || t.starts_with("https://") {
        if !t.contains('\n') && !t.contains(' ') {
            return ContentType::Url;
        }
    }

    // Email check
    if t.contains('@') && !t.contains('\n') && !t.contains(' ') {
        let parts: Vec<&str> = t.split('@').collect();
        if parts.len() == 2 && parts[1].contains('.') {
            return ContentType::Email;
        }
    }

    // Code heuristic
    if is_code_snippet(t) {
        return ContentType::Code;
    }

    ContentType::Text
}

fn is_code_snippet(t: &str) -> bool {
    let indicators = [
        "const ", "let ", "var ", "function ", "import ", "export ",
        "fn ", "pub fn ", "struct ", "impl ", "enum ", "def ",
        "class ", "public class ", "private ", "namespace ",
        "SELECT ", "INSERT INTO ", "UPDATE ", "DELETE FROM ",
        "<!DOCTYPE", "<html", "<div", "</", "=>", "->", "::", "{}",
    ];

    let mut matches = 0;
    for ind in indicators {
        if t.contains(ind) {
            matches += 1;
            if matches >= 2 {
                return true;
            }
        }
    }

    // Multiline with indentation/braces
    if t.lines().count() >= 3 && (t.contains('{') && t.contains('}')) {
        return true;
    }

    false
}

/// Computes BLAKE3 hash string
pub fn compute_content_hash(text: &str) -> String {
    blake3::hash(text.as_bytes()).to_hex().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_color_parser_hex() {
        assert_eq!(parse_and_normalize_color("#fff"), Some("#FFFFFF".to_string()));
        assert_eq!(parse_and_normalize_color("#f47735"), Some("#F47735".to_string()));
        assert_eq!(parse_and_normalize_color("#F47735AA"), Some("#F47735".to_string()));
        assert_eq!(parse_and_normalize_color("not_a_color"), None);
    }

    #[test]
    fn test_color_parser_rgb() {
        assert_eq!(parse_and_normalize_color("rgb(244, 119, 53)"), Some("#F47735".to_string()));
        assert_eq!(parse_and_normalize_color("rgba(0, 0, 0, 0.5)"), Some("#000000".to_string()));
    }

    #[test]
    fn test_color_parser_hsl() {
        // hsl(21, 90%, 58%) ~ #F47635
        let res = parse_and_normalize_color("hsl(0, 100%, 50%)");
        assert_eq!(res, Some("#FF0000".to_string()));
    }

    #[test]
    fn test_content_type_detection() {
        assert_eq!(detect_content_type("https://github.com", &None), ContentType::Url);
        assert_eq!(detect_content_type("contact@evry.com", &None), ContentType::Email);
        assert_eq!(
            detect_content_type("pub fn main() { println!(\"hi\"); }", &None),
            ContentType::Code
        );
        assert_eq!(
            detect_content_type("#F47735", &Some("#F47735".to_string())),
            ContentType::Color
        );
        assert_eq!(detect_content_type("Just a simple text note", &None), ContentType::Text);
    }

    #[test]
    fn test_content_hash() {
        let h1 = compute_content_hash("hello world");
        let h2 = compute_content_hash("hello world");
        let h3 = compute_content_hash("different");
        assert_eq!(h1, h2);
        assert_ne!(h1, h3);
    }
}

