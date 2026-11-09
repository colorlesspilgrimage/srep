use std::collections::{HashMap, HashSet};

/// Sanitize server-rendered card HTML while preserving text inside removed elements.
pub fn card_html(html: &str) -> String {
    // Ammonia drops `<svg>`/`<math>` subtrees wholesale (foreign content can
    // hide executable content), including their text. Card fields are user
    // content, so unwrap those wrappers first and let ammonia sanitize what
    // is inside them; the tags themselves are never kept.
    let html = strip_foreign_wrappers(html);
    let html = html.as_ref();

    let tags = [
        "a",
        "b",
        "blockquote",
        "br",
        "code",
        "div",
        "em",
        "hr",
        "i",
        "img",
        "li",
        "ol",
        "p",
        "pre",
        "s",
        "span",
        "strong",
        "sub",
        "sup",
        "u",
        "ul",
    ]
    .into_iter()
    .collect::<HashSet<_>>();
    let mut tag_attributes = HashMap::new();
    tag_attributes.insert("a", ["href"].into_iter().collect::<HashSet<_>>());
    // Images allowed per Sam's Nov 8, 2026 decision: http/https src only (see
    // url_schemes below), alt text, no event handlers or style attributes.
    tag_attributes.insert("img", ["src", "alt"].into_iter().collect::<HashSet<_>>());
    let url_schemes = ["http", "https", "mailto"]
        .into_iter()
        .collect::<HashSet<_>>();

    // Ammonia normally removes script/style contents as well as their tags. Card
    // fields are user content, so retain that text but escape it as text.
    ammonia::Builder::default()
        .tags(tags)
        .tag_attributes(tag_attributes)
        .generic_attributes(HashSet::new())
        .url_schemes(url_schemes)
        .rm_clean_content_tags(&["script", "style"])
        .clean(html)
        .to_string()
}

/// Remove `<svg>`/`<math>` open and close tags, keeping their inner content.
/// Only the tag itself is matched (case-insensitive, attributes allowed); the
/// content is left for ammonia to sanitize. This runs before ammonia because
/// ammonia drops foreign-content subtrees including their text.
fn strip_foreign_wrappers(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let bytes = html.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'<' {
            let rest = &html[i..];
            let lower = rest.to_ascii_lowercase();
            let is_wrapper = lower.starts_with("<svg")
                && matches!(
                    lower.as_bytes().get(4),
                    Some(b'>') | Some(b' ') | Some(b'\t') | Some(b'\n') | Some(b'\r') | Some(b'/')
                )
                || lower.starts_with("</svg")
                    && matches!(
                        lower.as_bytes().get(5),
                        Some(b'>') | Some(b' ') | Some(b'\t') | Some(b'\n') | Some(b'\r')
                    )
                || lower.starts_with("<math")
                    && matches!(
                        lower.as_bytes().get(5),
                        Some(b'>')
                            | Some(b' ')
                            | Some(b'\t')
                            | Some(b'\n')
                            | Some(b'\r')
                            | Some(b'/')
                    )
                || lower.starts_with("</math")
                    && matches!(
                        lower.as_bytes().get(6),
                        Some(b'>') | Some(b' ') | Some(b'\t') | Some(b'\n') | Some(b'\r')
                    );
            if is_wrapper {
                // Skip to the closing '>' of this tag.
                if let Some(end) = rest.find('>') {
                    i += end + 1;
                    continue;
                }
            }
        }
        // Copy one UTF-8 char.
        let ch_len = html[i..].chars().next().map_or(1, |c| c.len_utf8());
        out.push_str(&html[i..i + ch_len]);
        i += ch_len;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::card_html;

    #[test]
    fn keeps_basic_markup_and_removes_active_content() {
        let cleaned = card_html(
            "Front<hr><script>alert(1)</script><img src=x onerror=alert(2)>\
             <a href=\"javascript:alert(3)\" onclick=\"alert(4)\">link</a>",
        );
        assert!(cleaned.contains("<hr>"));
        assert!(cleaned.contains("alert(1)"));
        assert!(!cleaned.contains("<script"));
        // The img tag itself is allowed (Sam, Nov 8, 2026); only the event
        // handler is stripped.
        assert!(cleaned.contains("<img"));
        assert!(!cleaned.contains("onerror"));
        assert!(!cleaned.contains("onclick"));
        assert!(!cleaned.contains("javascript:"));
        assert!(cleaned.contains("link"));
    }

    #[test]
    fn keeps_safe_images_and_strips_unsafe_src() {
        let cleaned = card_html(
            "<img src=\"https://example.com/card.png\" alt=\"diagram\" onerror=alert(1)>",
        );
        assert!(cleaned.contains("src=\"https://example.com/card.png\""));
        assert!(cleaned.contains("alt=\"diagram\""));
        assert!(!cleaned.contains("onerror"));

        let cleaned = card_html("<img src=\"javascript:alert(1)\">");
        assert!(!cleaned.contains("javascript:"));

        let cleaned = card_html("<img src=\"data:image/png;base64,AAAA\">");
        assert!(!cleaned.contains("data:image"));
    }

    #[test]
    fn keeps_text_inside_svg_wrapper() {
        // Ammonia drops <svg>/<math> subtrees including their text; the
        // wrapper is unwrapped first so the text survives as text.
        let cleaned = card_html("<svg><script>alert(1)</script></svg><img src=x onerror=alert(1)>");
        assert!(cleaned.contains("alert(1)"));
        assert!(!cleaned.contains("<svg"));
        assert!(!cleaned.contains("<script"));
        // The img tag is allowed (Sam, Nov 8, 2026); the handler is stripped.
        assert!(cleaned.contains("<img"));
        assert!(!cleaned.contains("onerror"));
    }
}
