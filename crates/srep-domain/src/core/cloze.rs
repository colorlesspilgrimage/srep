pub const MAX_CLOZE_INDEX: i32 = 999;

#[derive(Debug, Clone)]
pub enum ClozeSegment {
    Text { text: String },
    Cloze {
        index: i32,
        text: String,
        hint: Option<String>,
        source: String,
    },
}

struct Match {
    start: usize,
    end: usize,
    segment: ClozeSegment,
}

fn read_digits(text: &str, from: usize) -> usize {
    let mut end = from;
    let bytes = text.as_bytes();
    while end < text.len() && bytes[end].is_ascii_digit() {
        end += 1;
    }
    end
}

fn next_cloze(text: &str, from: usize) -> Option<Match> {
    let mut at = from;
    loop {
        let start = text[at..].find("{{c").map(|i| i + at)?;
        let digits_end = read_digits(text, start + 3);
        let index: i32 = text[start + 3..digits_end].parse().unwrap_or(0);
        let valid = digits_end > start + 3
            && text[digits_end..].starts_with("::")
            && (1..=MAX_CLOZE_INDEX).contains(&index);
        if !valid {
            at = start + 1;
            continue;
        }
        let body_start = digits_end + 2;
        let close = text[body_start..].find("}}").map(|i| i + body_start)?;
        let body = &text[body_start..close];
        let split = body.find("::");
        let (cloze_text, hint) = match split {
            Some(i) => (body[..i].to_string(), Some(body[i + 2..].to_string())),
            None => (body.to_string(), None),
        };
        let source = text[start..close + 2].to_string();
        return Some(Match {
            start,
            end: close + 2,
            segment: ClozeSegment::Cloze {
                index,
                text: cloze_text,
                hint,
                source,
            },
        });
    }
}

pub fn parse_cloze(text: &str) -> Vec<ClozeSegment> {
    let mut segments = Vec::new();
    let mut cursor = 0;
    while let Some(m) = next_cloze(text, cursor) {
        if m.start > cursor {
            segments.push(ClozeSegment::Text {
                text: text[cursor..m.start].to_string(),
            });
        }
        segments.push(m.segment);
        cursor = m.end;
    }
    if cursor < text.len() {
        segments.push(ClozeSegment::Text {
            text: text[cursor..].to_string(),
        });
    }
    segments
}

pub fn cloze_indices(text: &str) -> Vec<i32> {
    let mut found = std::collections::BTreeSet::new();
    for seg in parse_cloze(text) {
        if let ClozeSegment::Cloze { index, .. } = seg {
            found.insert(index);
        }
    }
    found.into_iter().collect()
}

pub fn render_cloze(text: &str, active_index: i32, side: &str) -> String {
    let mut out = String::new();
    for seg in parse_cloze(text) {
        match seg {
            ClozeSegment::Text { text } => out.push_str(&text),
            ClozeSegment::Cloze {
                index,
                text,
                hint,
                ..
            } => {
                if index != active_index {
                    out.push_str(&text);
                } else if side == "back" {
                    out.push_str(&format!(r#"<span class="cloze">{text}</span>"#));
                } else {
                    let gap = hint.as_deref().unwrap_or("...");
                    out.push_str(&format!(r#"<span class="cloze">[{gap}]</span>"#));
                }
            }
        }
    }
    out
}
