//! Direct, SSH, SOCKS, HTTP CONNECT, and multi-hop transport primitives.

mod diagnostics;
mod forwarder;
mod plan;
mod protocol;
mod resolved;

pub use diagnostics::{
    ConnectionDiagnostics, DiagnosticStage, DiagnosticStageKind, DiagnosticStatus, DirectTcpProbe,
};
pub use forwarder::start_forwarder;
pub use plan::{DialTarget, HopRegistry, TransportPlan, TransportStep, TransportStepKind};
pub use protocol::{
    dial_resolved_transport, http_connect_handshake_sync, socks5_handshake_sync, HopStream,
    TunneledStream,
};
pub use resolved::{
    ResolvedProxy, ResolvedProxyAuth, ResolvedProxyChain, ResolvedProxyChainHop,
    ResolvedProxyHopConfig, ResolvedSshAuth, ResolvedSshTunnel, ResolvedTransport,
};

pub const CRATE_NAME: &str = "irodori-proxy";

#[cfg(test)]
mod tests;
