# Braid Tauri

Braid Tauri is an integrated application and service suite designed for high-performance synchronization using the Braid protocol. It provides a local-first user experience for collaborative editing, chat, and filesystem synchronization.

## Components

The project is organized as a workspace with several specialized packages:

- **xf_tauri**: The main desktop application built with Tauri. It includes a multi-protocol chat client and a Braid-aware file explorer.
- **server**: A backend server providing authentication, CRDT-backed storage, and AI chat integration.
- **braidfs-daemon**: A background process that synchronizes local filesystem changes with the Braid network.
- **braid-core**: A core library implementing synchronization logic, Braid-HTTP protocol handling, and merge types including Diamond Types and Simpleton.
- **braidfs-nfs**: A specialized service that exports Braid-synchronized folders via NFS.

## Key Features

- **Multi-Protocol Sync**: Support for multiple merge algorithms to ensure consistent synchronization across different peers.
- **Local-First Architecture**: Changes are saved locally and synchronized proactively, allowing for offline-capable workflows.
- **Integrated Service Dashboard**: A management script (run.bat) to control and monitor all background services.
- **Braid-Text Support**: Native implementation of Simpleton patches for compatibility with the wider Braid ecosystem.

## Setup and Development

System requirements include Rust, Node.js (for Tauri frontend), and a standard Windows environment for the provided scripts.

- Use **run.bat** to start the service dashboard and launch all components.
- Use **ide.bat** if you are primarily editing files locally and want them synchronized to the Braid network.
- Use **build_portable.bat** to generate a standalone executable.

Data is stored in the `braid_sync` directory by default, which is excluded from source control.
