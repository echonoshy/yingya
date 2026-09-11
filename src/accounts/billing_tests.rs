use super::*;

fn fixture() -> (Accounts, String) {
    let db = Accounts::open(Path::new(":memory:"), vec![]).unwrap();
    let (user, _) = db.login("billing@example.test").unwrap();
    (db, user.id)
}
fn record(db: &Accounts, user: &str, model: &str, input: i64, output: i64, cached: i64) {
    let mut charge = db.reserve_model(user).unwrap();
    charge.set_billing_model(model).unwrap();
    charge.mark_sent();
    charge.record_usage(Some(TokenUsage {
        input,
        output,
        cached,
        model: Some(model.into()),
    }));
    charge.settle(Some(input + output), 0).unwrap();
    charge.settle(Some(input + output), 0).unwrap();
}
fn this_month(db: &Accounts) -> String {
    db.0.lock()
        .unwrap()
        .query_row(
            "SELECT strftime('%Y-%m',?1,'unixepoch','+8 hours')",
            [now()],
            |r| r.get(0),
        )
        .unwrap()
}

#[test]
fn prices_use_actual_input_output_cache_and_do_not_duplicate_settlement() {
    let (db, user) = fixture();
    record(&db, &user, "gpt-6-astra", 100_000, 10_000, 20_000);
    let data = db.billing_report(Some(&user), &this_month(&db)).unwrap();
    assert_eq!(data["totals"]["calls"], 1);
    assert_eq!(data["totals"]["inputTokens"], 100_000);
    assert_eq!(data["totals"]["cachedInputTokens"], 20_000);
    assert_eq!(data["totals"]["outputTokens"], 10_000);
    assert_eq!(data["totals"]["inputCostUsd"], 0.82);
    assert_eq!(data["totals"]["outputCostUsd"], 0.5);
    assert_eq!(data["totals"]["totalCostUsd"], 1.32);
    assert_eq!(db.quota(&user).unwrap().used_tokens, 110_000);
}

#[test]
fn all_four_models_and_long_context_are_priced_in_integer_nanodollars() {
    for (model, total) in [
        ("gpt-6-astra", 1.5),
        ("gpt-5.6-sol", 0.6),
        ("gpt-5.6-terra", 0.32),
        ("gpt-5.6-luna", 0.032),
    ] {
        let (db, user) = fixture();
        record(&db, &user, model, 100_000, 10_000, 0);
        assert_eq!(
            db.billing_report(Some(&user), &this_month(&db)).unwrap()["totals"]["totalCostUsd"],
            total
        );
    }
    let (db, user) = fixture();
    record(&db, &user, "gpt-6-astra", 300_000, 10_000, 100_000);
    let data = db.billing_report(Some(&user), &this_month(&db)).unwrap();
    assert_eq!(data["totals"]["totalCostUsd"], 4.95);
    assert_eq!(data["lines"][0]["inputPerMillion"], 20.0);
    assert_eq!(data["lines"][0]["cachedInputPerMillion"], 2.0);
    assert_eq!(data["lines"][0]["outputPerMillion"], 75.0);
    let (db, user) = fixture();
    record(&db, &user, "gpt-5.6-luna", 1, 1, 0);
    assert_eq!(
        db.billing_report(Some(&user), &this_month(&db)).unwrap()["totals"]["totalCostUsd"],
        0.0000014
    );
}

#[test]
fn unknown_and_legacy_calls_are_not_fabricated_as_zero_cost() {
    let (db, user) = fixture();
    let mut charge = db.reserve_model(&user).unwrap();
    charge.set_billing_model("gpt-6-astra").unwrap();
    charge.mark_sent();
    drop(charge);
    let mut legacy = db.reserve_model(&user).unwrap();
    legacy.settle(Some(123), 0).unwrap();
    let data = db.billing_report(Some(&user), &this_month(&db)).unwrap();
    assert_eq!(data["totals"]["pendingCalls"], 2);
    assert_eq!(data["totals"]["knownCalls"], 0);
    assert_eq!(data["totals"]["inputTokens"], 0);
    let mut cancelled = db.reserve_model(&user).unwrap();
    cancelled.set_billing_model("gpt-5.6-sol").unwrap();
    cancelled.settle(Some(0), 0).unwrap();
    let data = db.billing_report(Some(&user), &this_month(&db)).unwrap();
    assert_eq!(data["totals"]["pendingCalls"], 2);
    assert_eq!(data["totals"]["knownCalls"], 1);
    assert_eq!(data["totals"]["totalCostUsd"], 0.0);
}

#[test]
fn invoices_are_idempotent_immutable_and_scoped_to_their_owner() {
    let (db, user) = fixture();
    let (other, _) = db.login("other@example.test").unwrap();
    record(&db, &user, "gpt-6-astra", 100_000, 10_000, 20_000);
    let month = this_month(&db);
    let invoice = db.create_invoice(&user, Some(&user), &month).unwrap();
    assert_eq!(
        db.create_invoice(&user, Some(&user), &month).unwrap(),
        invoice
    );
    let id = invoice["id"].as_str().unwrap();
    assert!(db.invoice(&other.id, false, id).unwrap().is_none());
    assert_eq!(db.invoice(&other.id, true, id).unwrap().unwrap(), invoice);
    record(&db, &user, "gpt-5.6-luna", 1, 1, 0);
    assert_eq!(db.invoice(&user, false, id).unwrap().unwrap(), invoice);
    assert_ne!(
        db.create_invoice(&user, Some(&user), &month).unwrap()["id"],
        invoice["id"]
    );
    record(&db, &other.id, "gpt-5.6-terra", 10_000, 1000, 0);
    assert_eq!(
        db.billing_report(Some(&user), &month).unwrap()["users"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        db.billing_report(None, &month).unwrap()["users"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let all = db.create_invoice(&user, None, &month).unwrap();
    assert!(
        db.invoice(&user, false, all["id"].as_str().unwrap())
            .unwrap()
            .is_none()
    );
}

#[test]
fn snapshot_names_keep_the_requested_rate_but_other_models_are_unpriced() {
    let (db, user) = fixture();
    for actual in ["gpt-6-astra-2026-09-11", "gpt-5.6-luna"] {
        let mut charge = db.reserve_model(&user).unwrap();
        charge.set_billing_model("gpt-6-astra").unwrap();
        charge.record_usage(Some(TokenUsage {
            input: 100,
            output: 10,
            cached: 0,
            model: Some(actual.into()),
        }));
        charge.settle(Some(110), 0).unwrap();
    }
    let data = db.billing_report(Some(&user), &this_month(&db)).unwrap();
    assert_eq!(data["totals"]["knownCalls"], 1);
    assert_eq!(data["totals"]["pendingCalls"], 1);
    assert_eq!(data["totals"]["totalCostUsd"], 0.0015);
}

#[test]
fn month_boundaries_use_shanghai_time_and_validate_input() {
    let (db, user) = fixture();
    record(&db, &user, "gpt-5.6-sol", 100, 20, 0);
    db.0.lock()
        .unwrap()
        .execute(
            "UPDATE model_charges SET created_at=unixepoch('2026-08-31 16:00:00')",
            [],
        )
        .unwrap();
    assert_eq!(
        db.billing_report(Some(&user), "2026-09").unwrap()["totals"]["calls"],
        1
    );
    assert_eq!(
        db.billing_report(Some(&user), "2026-08").unwrap()["totals"]["calls"],
        0
    );
    for month in [
        "2026-13",
        "2026-00",
        "2026-1",
        "2026-09-01",
        "../2026",
        "éé-09",
    ] {
        assert!(db.billing_report(Some(&user), month).is_err());
    }
}

#[test]
fn malformed_counts_and_reasoning_subtotals_do_not_create_extra_charges() {
    let parsed=TokenUsage::from_response(&json!({"model":"gpt-6-astra","usage":{"input_tokens":100,"output_tokens":50,"input_tokens_details":{"cached_tokens":20},"output_tokens_details":{"reasoning_tokens":40}}})).unwrap();
    assert_eq!(parsed.output, 50);
    for usage in [
        json!({"input_tokens":-1,"output_tokens":1}),
        json!({"input_tokens":1,"output_tokens":1,"input_tokens_details":{"cached_tokens":2}}),
        json!({"total_tokens":100}),
        json!({"input_tokens":2,"output_tokens":null}),
    ] {
        assert!(TokenUsage::from_response(&json!({"usage":usage})).is_none());
    }
}
