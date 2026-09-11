use super::*;
use std::collections::BTreeMap;

pub const PRICE_VERSION: &str = "openai-standard-2026-09-11";

#[derive(Clone, Debug)]
pub struct TokenUsage {
    pub input: i64,
    pub output: i64,
    pub cached: i64,
    pub model: Option<String>,
}

impl TokenUsage {
    pub fn from_response(response: &Value) -> Option<Self> {
        let usage = response.get("usage")?;
        let result = Self {
            input: usage["input_tokens"].as_i64()?,
            output: usage["output_tokens"].as_i64()?,
            cached: match usage.pointer("/input_tokens_details/cached_tokens") {
                Some(value) => value.as_i64()?,
                None => 0,
            },
            model: response["model"].as_str().map(str::to_owned),
        };
        ((0..=1_000_000_000).contains(&result.input)
            && (0..=1_000_000_000).contains(&result.output)
            && (0..=result.input).contains(&result.cached))
        .then_some(result)
    }
}

// Integer nanodollars per token: $1 / 1M tokens = 1,000 nanodollars/token.
fn rates(model: &str) -> Option<(i64, i64, i64)> {
    match model {
        "gpt-6-astra" => Some((10_000, 1_000, 50_000)),
        "gpt-5.6-sol" => Some((4_000, 400, 20_000)),
        "gpt-5.6-terra" => Some((2_000, 200, 12_000)),
        "gpt-5.6-luna" => Some((200, 20, 1_200)),
        _ => None,
    }
}

fn same_model(actual: &str, requested: &str) -> bool {
    if actual == requested || (actual == "gpt-5.6" && requested == "gpt-5.6-sol") {
        return true;
    }
    actual.strip_prefix(requested).is_some_and(|suffix| {
        suffix.len() == 11
            && suffix.bytes().enumerate().all(|(index, byte)| {
                if matches!(index, 0 | 5 | 8) {
                    byte == b'-'
                } else {
                    byte.is_ascii_digit()
                }
            })
    })
}

pub(super) fn migrate(db: &Connection) -> Result<(), String> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS billing_usage(
        charge_id TEXT PRIMARY KEY REFERENCES model_charges(id),model TEXT NOT NULL,
        input INTEGER,output INTEGER,cached INTEGER,input_rate INTEGER NOT NULL,cached_rate INTEGER NOT NULL,
        output_rate INTEGER NOT NULL,price_version TEXT NOT NULL,input_cost INTEGER,output_cost INTEGER);
        CREATE INDEX IF NOT EXISTS charges_date_user ON model_charges(created_at,user_id);
        CREATE TABLE IF NOT EXISTS billing_invoices(
        id TEXT PRIMARY KEY,owner TEXT,month TEXT NOT NULL,created_at INTEGER NOT NULL,
        fingerprint TEXT UNIQUE NOT NULL,payload TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS invoices_owner_month ON billing_invoices(owner,month);")
        .map_err(|e| e.to_string())
}

pub(super) fn begin(db: &Connection, id: &str, model: &str) -> Result<(), String> {
    let (input, cached, output) = rates(model).ok_or("模型没有已核对的 API 单价")?;
    db.execute("INSERT INTO billing_usage(charge_id,model,input_rate,cached_rate,output_rate,price_version)
        VALUES(?1,?2,?3,?4,?5,?6)", params![id, model, input, cached, output, PRICE_VERSION])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub(super) fn settle(
    db: &Connection,
    id: &str,
    usage: Option<&TokenUsage>,
    tokens: Option<i64>,
) -> Result<(), String> {
    let saved = db
        .query_row(
            "SELECT model,input_rate,cached_rate,output_rate FROM billing_usage WHERE charge_id=?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((model, mut input_rate, mut cached_rate, mut output_rate)) = saved else {
        return Ok(());
    };
    let zero = TokenUsage {
        input: 0,
        output: 0,
        cached: 0,
        model: None,
    };
    let Some(usage) = usage.or_else(|| (tokens == Some(0)).then_some(&zero)) else {
        return Ok(());
    };
    if usage
        .model
        .as_deref()
        .is_some_and(|actual| !same_model(actual, &model))
    {
        return Ok(());
    }
    if usage.input > 272_000 {
        input_rate *= 2;
        cached_rate *= 2;
        output_rate = output_rate * 3 / 2;
    }
    let input_cost = (usage.input - usage.cached) * input_rate + usage.cached * cached_rate;
    let output_cost = usage.output * output_rate;
    db.execute("UPDATE billing_usage SET input=?2,output=?3,cached=?4,input_rate=?5,cached_rate=?6,output_rate=?7,input_cost=?8,output_cost=?9 WHERE charge_id=?1",
        params![id, usage.input, usage.output, usage.cached, input_rate, cached_rate, output_rate, input_cost, output_cost])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn bounds(db: &Connection, month: &str) -> Result<(i64, i64), String> {
    if month.len() != 7
        || month.as_bytes()[4] != b'-'
        || !month
            .bytes()
            .enumerate()
            .all(|(i, b)| i == 4 || b.is_ascii_digit())
        || !(2000..=9998).contains(&month[..4].parse::<i32>().unwrap_or(0))
        || !(1..=12).contains(&month[5..].parse::<i32>().unwrap_or(0))
    {
        return Err("请选择有效的账单月份".into());
    }
    db.query_row(
        "SELECT unixepoch(?1||'-01','-8 hours'),unixepoch(?1||'-01','+1 month','-8 hours')",
        [month],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .map_err(|e| e.to_string())
}

#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Totals {
    calls: i64,
    known_calls: i64,
    pending_calls: i64,
    input_tokens: i64,
    output_tokens: i64,
    cached_input_tokens: i64,
    #[serde(skip)]
    input_nanos: i64,
    #[serde(skip)]
    output_nanos: i64,
    input_cost_usd: f64,
    output_cost_usd: f64,
    total_cost_usd: f64,
}
impl Totals {
    fn add(&mut self, other: &Self) {
        self.calls += other.calls;
        self.known_calls += other.known_calls;
        self.pending_calls += other.pending_calls;
        self.input_tokens += other.input_tokens;
        self.output_tokens += other.output_tokens;
        self.cached_input_tokens += other.cached_input_tokens;
        self.input_nanos += other.input_nanos;
        self.output_nanos += other.output_nanos;
        self.input_cost_usd = self.input_nanos as f64 / 1e9;
        self.output_cost_usd = self.output_nanos as f64 / 1e9;
        self.total_cost_usd = (self.input_nanos + self.output_nanos) as f64 / 1e9;
    }
}

fn report(db: &Connection, owner: Option<&str>, month: &str) -> Result<Value, String> {
    let (since, until) = bounds(db, month)?;
    let mut statement = db.prepare("SELECT c.user_id,u.email,COALESCE(b.model,'unknown'),b.price_version,
        b.input_rate,b.cached_rate,b.output_rate,COUNT(*),COUNT(b.input_cost),
        COALESCE(SUM(b.input),0),COALESCE(SUM(b.output),0),COALESCE(SUM(b.cached),0),
        COALESCE(SUM(b.input_cost),0),COALESCE(SUM(b.output_cost),0)
        FROM model_charges c JOIN users u ON u.id=c.user_id LEFT JOIN billing_usage b ON b.charge_id=c.id
        WHERE (?1 IS NULL OR c.user_id=?1) AND c.created_at>=?2 AND c.created_at<?3
        GROUP BY c.user_id,b.model,b.price_version,b.input_rate,b.cached_rate,b.output_rate
        ORDER BY u.email,b.model,b.input_rate").map_err(|e|e.to_string())?;
    let rows = statement
        .query_map(params![owner, since, until], |r| {
            let count = r.get::<_, i64>(7)?;
            let known = r.get::<_, i64>(8)?;
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<i64>>(4)?,
                r.get::<_, Option<i64>>(5)?,
                r.get::<_, Option<i64>>(6)?,
                Totals {
                    calls: count,
                    known_calls: known,
                    pending_calls: count - known,
                    input_tokens: r.get(9)?,
                    output_tokens: r.get(10)?,
                    cached_input_tokens: r.get(11)?,
                    input_nanos: r.get(12)?,
                    output_nanos: r.get(13)?,
                    ..Default::default()
                },
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut totals = Totals::default();
    let mut users: BTreeMap<String, (String, Totals)> = BTreeMap::new();
    let mut lines = Vec::new();
    for (id, email, model, version, input, cached, output, raw) in rows {
        let mut row = Totals::default();
        row.add(&raw);
        totals.add(&row);
        users
            .entry(id.clone())
            .or_insert_with(|| (email.clone(), Totals::default()))
            .1
            .add(&row);
        lines.push(json!({"userId":id,"email":email,"model":model,"priceVersion":version,
            "inputPerMillion":input.map(|r|r as f64/1000.0),"cachedInputPerMillion":cached.map(|r|r as f64/1000.0),
            "outputPerMillion":output.map(|r|r as f64/1000.0),"totals":row}));
    }
    let users: Vec<Value> = users
        .into_iter()
        .map(|(id, (email, totals))| json!({"userId":id,"email":email,"totals":totals}))
        .collect();
    let prices: Vec<Value> = crate::model_settings::ALLOWED_MODELS.iter().map(|model| {
        let (input,cached,output) = rates(model).unwrap();
        json!({"model":model,"inputPerMillion":input as f64/1000.0,"cachedInputPerMillion":cached as f64/1000.0,
            "outputPerMillion":output as f64/1000.0,"source":format!("https://developers.openai.com/api/docs/models/{model}")})
    }).collect();
    Ok(
        json!({"month":month,"since":since,"until":until,"currency":"USD","timeZone":"Asia/Shanghai",
        "priceVersion":PRICE_VERSION,"prices":prices,"totals":totals,"users":users,"lines":lines}),
    )
}

impl Accounts {
    pub fn billing_report(&self, owner: Option<&str>, month: &str) -> Result<Value, String> {
        let db = self.0.lock().map_err(|e| e.to_string())?;
        let mut data = report(&db, owner, month)?;
        let mut stmt = db.prepare("SELECT id,owner,created_at,payload FROM billing_invoices WHERE (?1 IS NULL OR owner=?1) AND month=?2 ORDER BY created_at DESC,id DESC LIMIT 100").map_err(|e|e.to_string())?;
        let invoices = stmt
            .query_map(params![owner, month], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        data["invoices"] = json!(invoices.into_iter().map(|(id,owner,created,payload)|{
            let value:Value=serde_json::from_str(&payload).unwrap_or(Value::Null);
            json!({"id":id,"userId":owner,"createdAt":created,"totalCostUsd":value["totals"]["totalCostUsd"],"pendingCalls":value["totals"]["pendingCalls"]})
        }).collect::<Vec<_>>());
        Ok(data)
    }

    pub fn create_invoice(
        &self,
        actor: &str,
        owner: Option<&str>,
        month: &str,
    ) -> Result<Value, String> {
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let mut payload = report(&tx, owner, month)?;
        if payload["totals"]["calls"] == 0 {
            return Err("这个月份暂无调用记录，无法生成账单".into());
        }
        let fingerprint = digest(&format!("{}:{}", owner.unwrap_or("all"), payload));
        if let Some(existing) = tx
            .query_row(
                "SELECT payload FROM billing_invoices WHERE fingerprint=?1",
                [&fingerprint],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
        {
            return serde_json::from_str(&existing).map_err(|e| e.to_string());
        }
        let id = format!(
            "YY-{}-{}",
            month.replace('-', ""),
            &Uuid::new_v4().simple().to_string()[..12]
        );
        let created = now();
        payload["id"] = json!(id);
        payload["createdAt"] = json!(created);
        payload["userId"] = json!(owner);
        tx.execute(
            "INSERT INTO billing_invoices VALUES(?1,?2,?3,?4,?5,?6)",
            params![id, owner, month, created, fingerprint, payload.to_string()],
        )
        .map_err(|e| e.to_string())?;
        super::management::audit(
            &tx,
            actor,
            "生成等价账单",
            &id,
            json!({"month":month,"userId":owner}),
        )?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(payload)
    }

    pub fn invoice(&self, requester: &str, admin: bool, id: &str) -> Result<Option<Value>, String> {
        let db = self.0.lock().map_err(|e| e.to_string())?;
        let payload = db
            .query_row(
                "SELECT payload FROM billing_invoices WHERE id=?1 AND (?2 OR owner=?3)",
                params![id, admin, requester],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        payload
            .map(|v| serde_json::from_str(&v).map_err(|e| e.to_string()))
            .transpose()
    }
}
