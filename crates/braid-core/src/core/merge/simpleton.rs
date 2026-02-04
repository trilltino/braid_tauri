//! Simpleton merge-type implementation.
//!
//! Matches the behavior of braid-text's simpleton-client.js.

use super::merge_type::{MergePatch, MergeResult, MergeType};
use serde_json::Value;
use std::collections::HashMap;
use tracing::warn;

#[derive(Debug, Clone)]
pub struct SimpletonMergeType {
    peer_id: String,
    content: String,
    version: Vec<String>,
    char_counter: i64,
}

impl SimpletonMergeType {
    pub fn new(peer_id: &str) -> Self {
        Self {
            peer_id: peer_id.to_string(),
            content: String::new(),
            version: Vec::new(),
            char_counter: -1,
        }
    }

    #[allow(dead_code)]
    fn simple_diff(&self, old_text: &str, new_text: &str) -> (usize, usize, String) {
        let a: Vec<char> = old_text.chars().collect();
        let b: Vec<char> = new_text.chars().collect();

        // Common prefix
        let mut p = 0;
        let len = std::cmp::min(a.len(), b.len());
        while p < len && a[p] == b[p] {
            p += 1;
        }

        // Common suffix
        let mut s = 0;
        let len_remaining = std::cmp::min(a.len() - p, b.len() - p);
        while s < len_remaining && a[a.len() - s - 1] == b[b.len() - s - 1] {
            s += 1;
        }

        let range_start = p;
        let range_end = a.len() - s;
        let content: String = b[p..b.len() - s].iter().collect();

        (range_start, range_end, content)
    }

    fn count_code_points(&self, s: &str) -> i64 {
        s.chars().count() as i64
    }
}

impl MergeType for SimpletonMergeType {
    fn name(&self) -> &str {
        "simpleton"
    }

    fn initialize(&mut self, content: &str) -> MergeResult {
        self.content = content.to_string();
        MergeResult::success(None, vec![])
    }

    fn apply_patch(&mut self, patch: MergePatch) -> MergeResult {
        // Range format: [start:end]
        if let Some(range) = patch
            .range
            .strip_prefix('[')
            .and_then(|s| s.strip_suffix(']'))
        {
            let parts: Vec<&str> = range.split(':').collect();
            if parts.len() == 2 {
                if let (Ok(start), Ok(end)) = (parts[0].parse::<usize>(), parts[1].parse::<usize>())
                {
                    let content_str = match &patch.content {
                        Value::String(s) => s.clone(),
                        v => v.to_string(),
                    };

                    let chars: Vec<char> = self.content.chars().collect();
                    if start <= chars.len() && end <= chars.len() && start <= end {
                        let mut new_chars = chars[..start].to_vec();
                        new_chars.extend(content_str.chars());
                        new_chars.extend(&chars[end..]);
                        self.content = new_chars.into_iter().collect();

                        if let Some(ref v) = patch.version {
                            self.version = vec![v.clone()];
                        }

                        return MergeResult::success(self.version.first().cloned(), vec![]);
                    }
                }
            }
        }

        warn!(
            "Simpleton: Invalid range format or indices: {}",
            patch.range
        );
        MergeResult::failure("Invalid range")
    }

    fn local_edit(&mut self, patch: MergePatch) -> MergeResult {
        // For simpleton, local edits are usually full text or diffed
        // If it's "everything", we replace all
        if patch.range == "everything" || patch.range == "[0:]" {
            self.content = match &patch.content {
                Value::String(s) => s.clone(),
                v => v.to_string(),
            };

            self.char_counter += self.count_code_points(&self.content);
            let version_id = format!("{}-{}", self.peer_id, self.char_counter);
            self.version = vec![version_id.clone()];

            return MergeResult::success(Some(version_id), vec![patch]);
        }

        // Otherwise try to apply as a patch
        self.apply_patch(patch)
    }

    fn get_content(&self) -> String {
        self.content.clone()
    }

    fn get_version(&self) -> Vec<String> {
        self.version.clone()
    }

    fn get_all_versions(&self) -> HashMap<String, Vec<String>> {
        let mut map = HashMap::new();
        if let Some(v) = self.version.first() {
            map.insert(v.clone(), vec![]);
        }
        map
    }

    fn prune(&mut self) -> bool {
        // Simpleton doesn't really have history to prune
        false
    }

    fn clone_box(&self) -> Box<dyn MergeType> {
        Box::new(self.clone())
    }
}
