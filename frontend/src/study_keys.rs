pub type StudyRating = u8;

pub enum StudyKeyAction {
    None,
    Reveal,
    Rate(StudyRating),
    Undo,
    Suspend,
    Edit,
}

pub fn study_key_action(
    key: &str,
    side: &str,
    target_is_field: bool,
    target_is_button: bool,
    modal_open: bool,
    palette_open: bool,
    in_flight: bool,
    status: &str,
) -> StudyKeyAction {
    if in_flight || target_is_field || modal_open || palette_open {
        return StudyKeyAction::None;
    }
    if key == "u" {
        return StudyKeyAction::Undo;
    }
    if status != "card" {
        return StudyKeyAction::None;
    }
    if side == "front" {
        if (key == " " || key == "Enter") && !target_is_button {
            return StudyKeyAction::Reveal;
        }
        if key == "s" {
            return StudyKeyAction::Suspend;
        }
        if key == "e" {
            return StudyKeyAction::Edit;
        }
        return StudyKeyAction::None;
    }
    match key {
        "1" => StudyKeyAction::Rate(1),
        "2" => StudyKeyAction::Rate(2),
        "3" => StudyKeyAction::Rate(3),
        "4" => StudyKeyAction::Rate(4),
        " " if !target_is_button => StudyKeyAction::Rate(3),
        "s" => StudyKeyAction::Suspend,
        "e" => StudyKeyAction::Edit,
        _ => StudyKeyAction::None,
    }
}
