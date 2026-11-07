use crate::types::{NoteTypeWithTemplates, TemplateRow};

#[derive(Debug, Clone)]
pub struct DesiredCard {
    pub template_id: String,
    pub ordinal: i32,
}

fn is_blank(s: &str) -> bool {
    s.chars().all(|c| c.is_whitespace() || c == '\u{00a0}')
}

fn render_simple(tpl: &str, fields: &[(String, String)]) -> String {
    let mut out = tpl.to_string();
    for (name, value) in fields {
        let token = format!("{{{{{}}}}}", name);
        out = out.replace(&token, value);
    }
    out
}

pub fn desired_cards(note_type: &NoteTypeWithTemplates, field_values: &[String]) -> Vec<DesiredCard> {
    let pairs: Vec<_> = note_type
        .fields
        .iter()
        .zip(field_values.iter())
        .map(|(n, v)| (n.clone(), v.clone()))
        .collect();
    let mut templates = note_type.templates.clone();
    templates.sort_by_key(|t| t.ordinal);
    let mut out = Vec::new();
    for template in templates {
        if template.front_tpl.contains("{{cloze:") {
            continue;
        }
        let rendered = render_simple(&template.front_tpl, &pairs);
        if !is_blank(&rendered) {
            out.push(DesiredCard {
                template_id: template.id.clone(),
                ordinal: 0,
            });
        }
    }
    out
}

pub fn field_checksum(sort_field: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(sort_field.as_bytes());
    hex::encode(hasher.finalize())
}
