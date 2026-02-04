//! braid-text: Simpleton merge-type and text diffing for Braid-HTTP.

use serde_json::Value;
use std::fmt::Debug;

/// Simpleton merge-type implementation.
///
/// Matches the behavior of braid-text's simpleton-client.js.
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
}

pub struct MergePatch {
    pub range: String,
    pub content: Value,
    pub version: Option<String>,
    pub parents: Vec<String>,
}

pub struct MergeResult {
    pub success: bool,
    pub rebased_patches: Vec<MergePatch>,
    pub version: Option<String>,
    pub error: Option<String>,
    pub body: Option<String>,
}

// NOTE: This will be integrated into the braid-core MergeType trait.
// For now we implement the core logic.

impl SimpletonMergeType {
    pub fn apply_patch(&mut self, patch: MergePatch) -> MergeResult {
        // Implement simpleton patching logic...
        // For now, mirroring simpleton-client.js behavior

        let range_regex = regex::Regex::new(r"\[(\d+):(\d+)\]").unwrap();
        if let Some(caps) = range_regex.captures(&patch.range) {
            let start: usize = caps[1].parse().unwrap_or(0);
            let end: usize = caps[2].parse().unwrap_or(0);

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

                if let Some(v) = patch.version {
                    self.version = vec![v];
                }

                return MergeResult {
                    success: true,
                    rebased_patches: vec![],
                    version: self.version.first().cloned(),
                    error: None,
                    body: Some(self.content.clone()),
                };
            }
        }

        MergeResult {
            success: false,
            rebased_patches: vec![],
            version: None,
            error: Some("Invalid range".to_string()),
            body: None,
        }
    }
}
