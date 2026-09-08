//! Durable identities and usage. This database is never mounted into an Agent sandbox.
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

#[derive(Clone)]
pub struct Accounts(Arc<Mutex<Connection>>, Arc<Vec<String>>);
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub email: String,
    pub is_admin: bool,
}
pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
fn digest(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
pub fn secret() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

impl Accounts {
    pub fn open(path: &Path, admins: Vec<String>) -> Result<Self, String> {
        let db = Connection::open(path).map_err(|e| e.to_string())?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
          CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,created_at INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS requests(user_id TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,id));
          CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,model TEXT NOT NULL,project_id TEXT,kind TEXT NOT NULL,totals TEXT NOT NULL DEFAULT '{}');
          CREATE TABLE IF NOT EXISTS turns(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,user_id TEXT NOT NULL,model TEXT NOT NULL,project_id TEXT,kind TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'running',known INTEGER NOT NULL DEFAULT 0,input INTEGER NOT NULL DEFAULT 0,output INTEGER NOT NULL DEFAULT 0,cached INTEGER NOT NULL DEFAULT 0,reasoning INTEGER NOT NULL DEFAULT 0,total INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
          CREATE INDEX IF NOT EXISTS turns_user_date ON turns(user_id,created_at);
          UPDATE turns SET status='interrupted' WHERE status='running';").map_err(|e| e.to_string())?;
        Ok(Self(
            Arc::new(Mutex::new(db)),
            Arc::new(
                admins
                    .into_iter()
                    .map(|s| s.trim().to_lowercase())
                    .collect(),
            ),
        ))
    }
    pub fn login(&self, email: &str) -> Result<(User, String), String> {
        let email = email.trim().to_lowercase();
        let parts: Vec<_> = email.split('@').collect();
        if email.len() > 254
            || parts.len() != 2
            || parts[0].is_empty()
            || !parts[1].contains('.')
            || parts[1].starts_with('.')
            || parts[1].ends_with('.')
            || email.chars().any(|c| c.is_whitespace() || c.is_control())
        {
            return Err("请输入有效的邮箱地址".into());
        }
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR IGNORE INTO users VALUES(?1,?2,?3)",
            params![Uuid::new_v4().to_string(), email, now()],
        )
        .map_err(|e| e.to_string())?;
        let id: String = tx
            .query_row("SELECT id FROM users WHERE email=?1", [&email], |r| {
                r.get(0)
            })
            .map_err(|e| e.to_string())?;
        let token = secret();
        tx.execute("DELETE FROM sessions WHERE expires_at<=?1", [now()])
            .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO sessions VALUES(?1,?2,?3)",
            params![digest(&token), id, now() + 30 * 86400],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok((
            User {
                id,
                email: email.clone(),
                is_admin: self.1.contains(&email),
            },
            token,
        ))
    }
    pub fn session(&self, token: &str) -> Option<User> {
        self.0.lock().ok()?.query_row("SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=?1 AND s.expires_at>?2",params![digest(token),now()],|r| { let email:String=r.get(1)?; Ok(User{id:r.get(0)?,is_admin:self.1.contains(&email),email}) }).optional().ok().flatten()
    }
    pub fn logout(&self, token: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .execute("DELETE FROM sessions WHERE hash=?1", [digest(token)])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn request(&self, user: &str, id: &str, kind: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .execute(
                "INSERT OR IGNORE INTO requests VALUES(?1,?2,?3,?4)",
                params![user, id, kind, now()],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn thread(
        &self,
        id: &str,
        user: &str,
        model: &str,
        project: Option<&str>,
        kind: &str,
    ) -> Result<(), String> {
        self.0.lock().map_err(|e|e.to_string())?.execute("INSERT INTO threads(id,user_id,model,project_id,kind) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET model=excluded.model",params![id,user,model,project,kind]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn owns_thread(&self, id: &str, user: &str) -> bool {
        self.0
            .lock()
            .ok()
            .and_then(|db| {
                db.query_row(
                    "SELECT 1 FROM threads WHERE id=?1 AND user_id=?2",
                    params![id, user],
                    |_| Ok(()),
                )
                .optional()
                .ok()
                .flatten()
            })
            .is_some()
    }
    pub fn set_model(&self, id: &str, model: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .execute(
                "UPDATE threads SET model=?2 WHERE id=?1",
                params![id, model],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn event(&self, raw: &Value) -> Result<(), String> {
        let method = raw["method"].as_str().unwrap_or("");
        if !matches!(
            method,
            "turn/started" | "turn/completed" | "thread/tokenUsage/updated"
        ) {
            return Ok(());
        }
        let p = &raw["params"];
        let Some(thread) = p["threadId"].as_str() else {
            return Ok(());
        };
        let Some(turn) = p["turnId"].as_str().or(p["turn"]["id"].as_str()) else {
            return Ok(());
        };
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        tx.execute("INSERT OR IGNORE INTO turns(id,thread_id,user_id,model,project_id,kind,created_at) SELECT ?1,id,user_id,model,project_id,kind,?3 FROM threads WHERE id=?2",params![turn,thread,now()]).map_err(|e|e.to_string())?;
        if method == "turn/completed" {
            tx.execute(
                "UPDATE turns SET status=?2 WHERE id=?1",
                params![turn, p["turn"]["status"].as_str().unwrap_or("unknown")],
            )
            .map_err(|e| e.to_string())?;
        }
        if method == "thread/tokenUsage/updated" && p["tokenUsage"]["total"].is_object() {
            let saved: Option<String> = tx
                .query_row("SELECT totals FROM threads WHERE id=?1", [thread], |r| {
                    r.get(0)
                })
                .optional()
                .map_err(|e| e.to_string())?;
            if let Some(saved) = saved {
                let mut previous: Value =
                    serde_json::from_str(&saved).map_err(|e| e.to_string())?;
                let mut delta = Vec::new();
                for key in [
                    "inputTokens",
                    "outputTokens",
                    "cachedInputTokens",
                    "reasoningOutputTokens",
                    "totalTokens",
                ] {
                    let old = previous[key].as_i64().unwrap_or(0).max(0);
                    let new = p["tokenUsage"]["total"][key]
                        .as_i64()
                        .unwrap_or(old)
                        .max(old);
                    delta.push(new - old);
                    previous[key] = json!(new);
                }
                tx.execute("UPDATE turns SET known=1,input=input+?2,output=output+?3,cached=cached+?4,reasoning=reasoning+?5,total=total+?6 WHERE id=?1",params![turn,delta[0],delta[1],delta[2],delta[3],delta[4]]).map_err(|e|e.to_string())?;
                tx.execute(
                    "UPDATE threads SET totals=?2 WHERE id=?1",
                    params![thread, previous.to_string()],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())
    }
    pub fn usage(
        &self,
        user: Option<&str>,
        since: i64,
        until: i64,
        model: Option<&str>,
    ) -> Result<Value, String> {
        let db = self.0.lock().map_err(|e| e.to_string())?;
        let mut stmt=db.prepare("SELECT u.id,u.email,
          (SELECT COUNT(*) FROM requests r WHERE r.user_id=u.id AND r.created_at>=?2 AND r.created_at<?3),
          COUNT(t.id),COALESCE(SUM(t.input),0),COALESCE(SUM(t.output),0),COALESCE(SUM(t.cached),0),COALESCE(SUM(t.reasoning),0),COALESCE(SUM(t.total),0),COALESCE(SUM(CASE WHEN t.id IS NOT NULL AND t.known=0 THEN 1 ELSE 0 END),0)
          FROM users u LEFT JOIN turns t ON t.user_id=u.id AND t.created_at>=?2 AND t.created_at<?3 AND (?4 IS NULL OR t.model=?4)
          WHERE (?1 IS NULL OR u.id=?1) GROUP BY u.id ORDER BY SUM(t.total) DESC,u.email").map_err(|e|e.to_string())?;
        let rows=stmt.query_map(params![user,since,until,model],|r|Ok(json!({"userId":r.get::<_,String>(0)?,"email":r.get::<_,String>(1)?,"requests":r.get::<_,i64>(2)?,"executions":r.get::<_,i64>(3)?,"inputTokens":r.get::<_,i64>(4)?,"outputTokens":r.get::<_,i64>(5)?,"cachedInputTokens":r.get::<_,i64>(6)?,"reasoningOutputTokens":r.get::<_,i64>(7)?,"totalTokens":r.get::<_,i64>(8)?,"unknownExecutions":r.get::<_,i64>(9)?}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
        let mut stmt = db
            .prepare(
                "SELECT DISTINCT model FROM turns WHERE (?1 IS NULL OR user_id=?1) ORDER BY model",
            )
            .map_err(|e| e.to_string())?;
        let models = stmt
            .query_map([user], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(json!({"users":rows,"models":models,"since":since,"until":until}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restart_keeps_sessions_usage_and_admin_configuration() {
        let path =
            std::env::temp_dir().join(format!("yingya-account-test-{}.sqlite", Uuid::new_v4()));
        let (id, token) = {
            let db = Accounts::open(&path, vec!["admin@example.com".into()]).unwrap();
            let (first, token) = db.login("first@example.com").unwrap();
            assert!(!first.is_admin);
            assert!(db.login("admin@example.com").unwrap().0.is_admin);
            db.thread("persisted", &first.id, "model", None, "image")
                .unwrap();
            db.event(&json!({"method":"thread/tokenUsage/updated","params":{"threadId":"persisted","turnId":"turn","tokenUsage":{"total":{"totalTokens":42}}}})).unwrap();
            (first.id, token)
        };
        let db = Accounts::open(&path, vec![]).unwrap();
        assert_eq!(db.session(&token).unwrap().id, id);
        assert_eq!(
            db.usage(Some(&id), 0, now() + 1, None).unwrap()["users"][0]["totalTokens"],
            42
        );
        assert!(
            db.usage(Some("another-user"), 0, now() + 1, None).unwrap()["users"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        drop(db);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn sessions_and_usage_survive_retries_and_failures() {
        let db = Accounts::open(Path::new(":memory:"), vec!["admin@example.com".into()]).unwrap();
        let (a, token) = db.login(" A@Example.com ").unwrap();
        let (again, _) = db.login("a@example.com").unwrap();
        assert_eq!(a.id, again.id);
        assert!(!a.is_admin);
        assert_eq!(db.session(&token).unwrap().id, a.id);
        db.request(&a.id, "r1", "agent").unwrap();
        db.request(&a.id, "r1", "agent").unwrap();
        db.thread("t1", &a.id, "test", None, "agent").unwrap();
        let e = json!({"method":"thread/tokenUsage/updated","params":{"threadId":"t1","turnId":"turn1","tokenUsage":{"total":{"inputTokens":100,"outputTokens":20,"totalTokens":120}}}});
        db.event(&e).unwrap();
        db.event(&e).unwrap();
        db.event(&json!({"method":"thread/tokenUsage/updated","params":{"threadId":"t1","turnId":"turn2","tokenUsage":{"total":{"inputTokens":140,"outputTokens":30,"totalTokens":170}}}})).unwrap();
        db.event(&json!({"method":"turn/completed","params":{"threadId":"t1","turn":{"id":"turn2","status":"failed"}}})).unwrap();
        let report = db.usage(Some(&a.id), 0, now() + 1, None).unwrap();
        assert_eq!(report["users"][0]["requests"], 1);
        assert_eq!(report["users"][0]["executions"], 2);
        assert_eq!(report["users"][0]["totalTokens"], 170);
        assert!(!db.owns_thread("t1", "other"));
        db.logout(&token).unwrap();
        assert!(db.session(&token).is_none());
    }
}
