use std::{collections::HashMap, sync::Arc};

use tokio::sync::{Mutex, OwnedMutexGuard};

use crate::codex::TurnCancellation;

#[derive(Clone)]
pub struct ActiveAgentTurn {
    pub cancellation: TurnCancellation,
    pub request_id: String,
    pub context: Vec<String>,
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    #[tokio::test]
    async fn serializes_one_hundred_operations_for_the_same_project() {
        let coordinator = AgentJobCoordinator::default();
        let active = Arc::new(AtomicUsize::new(0));
        let maximum = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..100 {
            let coordinator = coordinator.clone();
            let active = active.clone();
            let maximum = maximum.clone();
            tasks.push(tokio::spawn(async move {
                let _guard = coordinator.lock("project").await;
                let current = active.fetch_add(1, Ordering::SeqCst) + 1;
                maximum.fetch_max(current, Ordering::SeqCst);
                tokio::task::yield_now().await;
                active.fetch_sub(1, Ordering::SeqCst);
            }));
        }
        for task in tasks {
            task.await.expect("coordinator task");
        }
        assert_eq!(maximum.load(Ordering::SeqCst), 1);
    }
}

#[derive(Clone, Default)]
pub struct AgentJobCoordinator {
    gates: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
    active: Arc<Mutex<HashMap<String, ActiveAgentTurn>>>,
}

impl AgentJobCoordinator {
    pub async fn lock(&self, project_id: &str) -> OwnedMutexGuard<()> {
        let gate = {
            let mut gates = self.gates.lock().await;
            gates
                .entry(project_id.to_owned())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        gate.lock_owned().await
    }

    pub async fn active(&self, project_id: &str) -> Option<ActiveAgentTurn> {
        self.active.lock().await.get(project_id).cloned()
    }

    pub async fn contains(&self, project_id: &str) -> bool {
        self.active.lock().await.contains_key(project_id)
    }

    pub async fn insert(&self, project_id: String, turn: ActiveAgentTurn) {
        self.active.lock().await.insert(project_id, turn);
    }

    pub async fn remove(&self, project_id: &str) -> Option<ActiveAgentTurn> {
        self.active.lock().await.remove(project_id)
    }

    pub async fn active_projects(&self) -> Vec<(String, ActiveAgentTurn)> {
        self.active
            .lock()
            .await
            .iter()
            .map(|(id, turn)| (id.clone(), turn.clone()))
            .collect()
    }

    pub async fn remove_project(&self, project_id: &str) {
        self.active.lock().await.remove(project_id);
        self.gates.lock().await.remove(project_id);
    }
}
