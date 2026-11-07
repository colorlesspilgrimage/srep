use srep_settings::KeybindMap;
use serde::Serialize;

const THEME_IDS: &[&str] = &["xai-dark", "xai-light", "high-contrast"];

pub struct ShellPrefs {
    pub theme_id: String,
    pub keybinds: KeybindMap,
}

pub fn theme_label(id: &str) -> &'static str {
    match id {
        "xai-light" => "xAI Light",
        "high-contrast" => "High Contrast",
        _ => "xAI Dark",
    }
}

pub fn normalize_theme(id: &str) -> String {
    if THEME_IDS.contains(&id) {
        id.to_string()
    } else {
        "xai-dark".to_string()
    }
}

fn open_hint(chord: &str) -> String {
    format!("{chord} palette")
}

fn close_hint(chord: &str) -> String {
    if chord == "Escape" {
        "Esc close".to_string()
    } else {
        format!("{chord} close")
    }
}

fn mode_for_path(path: &str) -> &'static str {
    if path.starts_with("/study") {
        "STUDY"
    } else if path.starts_with("/settings") {
        "SETTINGS"
    } else if path.starts_with("/browse") {
        "BROWSE"
    } else if path.starts_with("/stats") {
        "STATS"
    } else if path.starts_with("/gallery") {
        "GALLERY"
    } else {
        "DECKS"
    }
}

#[derive(Serialize)]
struct ShellPrefsJson<'a> {
    theme_id: &'a str,
    keybinds: &'a KeybindMap,
}

pub fn inject_spa_html(html: &str, path: &str, prefs: &ShellPrefs) -> String {
    let gallery = path.starts_with("/gallery");
    let app_root = if gallery { "" } else { " app-root" };
    let theme_id = normalize_theme(&prefs.theme_id);
    let theme_class = format!("tui-theme-{theme_id}");
    let mode = mode_for_path(path);
    let open = open_hint(&prefs.keybinds.palette_open);
    let close = close_hint(&prefs.keybinds.palette_close);
    let name = theme_label(&theme_id);
    let status = format!("{mode} | {open} | {close} | {name}");
    let marker = format!("<!-- srep-shell: tui-root{app_root} {theme_class} -->");
    let prefs_tag = serde_json::to_string(&ShellPrefsJson {
        theme_id: &theme_id,
        keybinds: &prefs.keybinds,
    })
    .map(|json| format!("<!-- srep-prefs:{json} -->"))
    .unwrap_or_default();
    let noscript = format!(
        r#"<noscript><div class="tui-root{app_root} {theme_class}"></div></noscript>"#
    );
    let footer = format!(
        r#"<footer class="tui-ssr-status tui-status" hidden>{status}</footer>"#
    );
    html.replace(
        "<div id=\"root\"></div>",
        &format!("<div id=\"root\"></div>{marker}{prefs_tag}{noscript}{footer}"),
    )
}
