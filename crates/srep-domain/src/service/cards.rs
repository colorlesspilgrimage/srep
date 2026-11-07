use crate::core::card_state::{plan_bury, plan_suspend, plan_unsuspend};
use crate::core::validation::CardIdsInput;
use crate::deps::DomainCtx;
use crate::error::{fail, ApiResult};
use crate::store::change_card_states;

const DAY_MS: i64 = 86_400_000;

pub async fn suspend_cards(ctx: &DomainCtx<'_>, input: CardIdsInput) -> ApiResult<()> {
    let store = ctx.store();
    match change_card_states(&store, &input.card_ids, |cards| Ok(plan_suspend(cards))).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(fail(
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "bad_request",
        )),
    }
}

pub async fn unsuspend_cards(ctx: &DomainCtx<'_>, input: CardIdsInput) -> ApiResult<()> {
    let store = ctx.store();
    match change_card_states(&store, &input.card_ids, plan_unsuspend).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(fail(
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "bad_request",
        )),
    }
}

pub async fn bury_cards(ctx: &DomainCtx<'_>, input: CardIdsInput) -> ApiResult<()> {
    let end_ms = ctx.now_ms() / DAY_MS * DAY_MS + DAY_MS;
    let store = ctx.store();
    match change_card_states(&store, &input.card_ids, |cards| {
        Ok(plan_bury(cards, end_ms))
    })
    .await
    {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(fail(
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "bad_request",
        )),
    }
}
