use crate::types::{NoteTypeRow, NoteTypeWithTemplates, PresetRow, SeedInput, TemplateRow};

pub const DEFAULT_PRESET_ID: &str = "00000000-0000-4000-8000-000000000001";
pub const BASIC_ID: &str = "00000000-0000-4000-8000-000000000011";
pub const BASIC_REVERSED_ID: &str = "00000000-0000-4000-8000-000000000012";
pub const CLOZE_ID: &str = "00000000-0000-4000-8000-000000000013";
pub const BASIC_CARD_ID: &str = "00000000-0000-4000-8000-000000000021";
pub const REVERSED_CARD_1_ID: &str = "00000000-0000-4000-8000-000000000022";
pub const REVERSED_CARD_2_ID: &str = "00000000-0000-4000-8000-000000000023";
pub const CLOZE_CARD_ID: &str = "00000000-0000-4000-8000-000000000024";

pub const BUILTIN_NOTE_TYPE_IDS: &[&str] = &[BASIC_ID, BASIC_REVERSED_ID, CLOZE_ID];

pub fn builtin_preset() -> PresetRow {
    PresetRow {
        id: DEFAULT_PRESET_ID.into(),
        name: "Default".into(),
        new_per_day: 20,
        reviews_per_day: 200,
        desired_retention: 0.9,
        learning_steps: vec![1, 10],
        relearning_steps: vec![10],
        max_interval: 36_500,
        fsrs_params: None,
        bury_siblings: false,
        new_order: "added".into(),
    }
}

fn template(
    id: &str,
    note_type_id: &str,
    ordinal: i32,
    name: &str,
    front_tpl: &str,
    back_tpl: &str,
) -> TemplateRow {
    TemplateRow {
        id: id.into(),
        note_type_id: note_type_id.into(),
        name: name.into(),
        ordinal,
        front_tpl: front_tpl.into(),
        back_tpl: back_tpl.into(),
    }
}

fn note_type(id: &str, name: &str, fields: &[&str], css_class: &str) -> NoteTypeRow {
    NoteTypeRow {
        id: id.into(),
        name: name.into(),
        fields: fields.iter().map(|s| (*s).into()).collect(),
        css_class: css_class.into(),
        sort_field_idx: 0,
    }
}

pub fn builtin_seed() -> SeedInput {
    let card_1 = ("{{Front}}", "{{Front}}<hr>{{Back}}");
    let card_2 = ("{{Back}}", "{{Back}}<hr>{{Front}}");
    SeedInput {
        preset: builtin_preset(),
        note_types: vec![
            NoteTypeWithTemplates::from_parts(
                note_type(BASIC_ID, "Basic", &["Front", "Back"], "basic"),
                vec![template(
                    BASIC_CARD_ID,
                    BASIC_ID,
                    0,
                    "Card 1",
                    card_1.0,
                    card_1.1,
                )],
            ),
            NoteTypeWithTemplates::from_parts(
                note_type(
                    BASIC_REVERSED_ID,
                    "Basic+Reversed",
                    &["Front", "Back"],
                    "basic-reversed",
                ),
                vec![
                    template(
                        REVERSED_CARD_1_ID,
                        BASIC_REVERSED_ID,
                        0,
                        "Card 1",
                        card_1.0,
                        card_1.1,
                    ),
                    template(
                        REVERSED_CARD_2_ID,
                        BASIC_REVERSED_ID,
                        1,
                        "Card 2",
                        card_2.0,
                        card_2.1,
                    ),
                ],
            ),
            NoteTypeWithTemplates::from_parts(
                note_type(CLOZE_ID, "Cloze", &["Text", "Extra"], "cloze"),
                vec![template(
                    CLOZE_CARD_ID,
                    CLOZE_ID,
                    0,
                    "Cloze",
                    "{{cloze:Text}}",
                    "{{cloze:Text}}<br>{{Extra}}",
                )],
            ),
        ],
    }
}
