use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayStats {
    pub reviews: u32,
    pub minutes: u32,
    pub new: u32,
    pub again: u32,
}

pub fn summarize_today(rows: &[(i64, i32, String)]) -> TodayStats {
    let mut reviews = 0u32;
    let minutes = 0u32;
    let mut new = 0u32;
    let mut again = 0u32;
    for (_, rating, state_before) in rows {
        reviews += 1;
        if *rating == 1 {
            again += 1;
        }
        if state_before == "new" {
            new += 1;
        }
    }
    TodayStats {
        reviews,
        minutes,
        new,
        again,
    }
}
