use std::path::PathBuf;

pub fn load_root() -> Option<PathBuf> {
    braid_common::load_persistent_root()
}

pub fn save_root(root: PathBuf) -> anyhow::Result<()> {
    braid_common::save_persistent_root(root)
}
