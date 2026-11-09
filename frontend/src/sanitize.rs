use std::collections::{HashMap, HashSet};

/// Sanitize server-rendered card HTML while preserving text inside removed elements.
pub fn card_html(html: &str) -> String {
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
        assert!(!cleaned.contains("<img"));
        assert!(!cleaned.contains("onclick"));
        assert!(!cleaned.contains("javascript:"));
        assert!(cleaned.contains("link"));
    }
}
