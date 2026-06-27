use std::time::Duration;

use crate::protocol::{dial_resolved_transport, HopStream, TunneledStream};
use crate::resolved::ResolvedTransport;

struct Buffer {
    data: Vec<u8>,
    read_pos: usize,
    write_pos: usize,
}

impl Buffer {
    fn new(capacity: usize) -> Self {
        Self {
            data: vec![0; capacity],
            read_pos: 0,
            write_pos: 0,
        }
    }

    fn is_empty(&self) -> bool {
        self.read_pos == self.write_pos
    }

    fn available_write(&self) -> usize {
        self.data.len() - self.write_pos
    }

    fn write_slice(&mut self) -> &mut [u8] {
        &mut self.data[self.write_pos..]
    }

    fn read_slice(&self) -> &[u8] {
        &self.data[self.read_pos..self.write_pos]
    }

    fn did_write(&mut self, n: usize) {
        self.write_pos += n;
    }

    fn did_read(&mut self, n: usize) {
        self.read_pos += n;
        if self.read_pos == self.write_pos {
            self.read_pos = 0;
            self.write_pos = 0;
        }
    }

    fn compact(&mut self) {
        if self.read_pos > 0 {
            let len = self.write_pos - self.read_pos;
            self.data.copy_within(self.read_pos..self.write_pos, 0);
            self.read_pos = 0;
            self.write_pos = len;
        }
    }
}

async fn forward_connection<T>(
    client_stream: tokio::net::TcpStream,
    mut remote_stream: T,
) -> std::result::Result<(), String>
where
    T: std::io::Read + std::io::Write + Unpin,
{
    let mut client_to_remote = Buffer::new(32768);
    let mut remote_to_client = Buffer::new(32768);

    loop {
        let mut made_progress = false;

        // 1. Write to remote
        if !client_to_remote.is_empty() {
            match remote_stream.write(client_to_remote.read_slice()) {
                Ok(n) if n > 0 => {
                    client_to_remote.did_read(n);
                    made_progress = true;
                }
                Ok(_) => {}
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => return Err(format!("remote write failed: {e}")),
            }
        }

        // 2. Read from client
        if client_to_remote.available_write() > 0 {
            match client_stream.try_read(client_to_remote.write_slice()) {
                Ok(0) => {
                    if client_to_remote.is_empty() {
                        break;
                    }
                }
                Ok(n) if n > 0 => {
                    client_to_remote.did_write(n);
                    made_progress = true;
                }
                Ok(_) => {}
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => return Err(format!("client read failed: {e}")),
            }
        } else {
            client_to_remote.compact();
        }

        // 3. Write to client
        if !remote_to_client.is_empty() {
            match client_stream.try_write(remote_to_client.read_slice()) {
                Ok(n) if n > 0 => {
                    remote_to_client.did_read(n);
                    made_progress = true;
                }
                Ok(_) => {}
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => return Err(format!("client write failed: {e}")),
            }
        }

        // 4. Read from remote
        if remote_to_client.available_write() > 0 {
            match remote_stream.read(remote_to_client.write_slice()) {
                Ok(0) => {
                    if remote_to_client.is_empty() {
                        break;
                    }
                }
                Ok(n) if n > 0 => {
                    remote_to_client.did_write(n);
                    made_progress = true;
                }
                Ok(_) => {}
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => return Err(format!("remote read failed: {e}")),
            }
        } else {
            remote_to_client.compact();
        }

        if !made_progress {
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    }
    Ok(())
}

async fn forward_connection_stream(
    client_stream: tokio::net::TcpStream,
    tunneled: TunneledStream,
) -> std::result::Result<(), String> {
    match tunneled.stream {
        HopStream::Tcp(s) => forward_connection(client_stream, s).await,
        HopStream::Ssh(c) => forward_connection(client_stream, c).await,
    }
}

pub async fn start_forwarder(
    resolved: ResolvedTransport,
) -> std::result::Result<(u16, tokio_util::sync::CancellationToken), String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("failed to bind local forwarder listener: {e}"))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| format!("failed to get listener address: {e}"))?
        .port();

    let cancellation_token = tokio_util::sync::CancellationToken::new();
    let token_clone = cancellation_token.clone();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = token_clone.cancelled() => {
                    break;
                }
                accept_res = listener.accept() => {
                    match accept_res {
                        Ok((client_stream, _)) => {
                            let resolved_clone = resolved.clone();
                            let token = token_clone.clone();
                            tokio::spawn(async move {
                                let dial_res = tokio::task::spawn_blocking(move || {
                                    dial_resolved_transport(&resolved_clone)
                                }).await;

                                let tunneled = match dial_res {
                                    Ok(Ok(t)) => t,
                                    Ok(Err(e)) => {
                                        eprintln!("failed to dial target for forwarded connection: {e}");
                                        return;
                                    }
                                    Err(e) => {
                                        eprintln!("spawn_blocking failed during dial: {e}");
                                        return;
                                    }
                                };

                                if let Err(e) = tunneled.set_nonblocking(true) {
                                    eprintln!("failed to set nonblocking on tunneled stream: {e}");
                                    return;
                                }

                                tokio::select! {
                                    _ = token.cancelled() => {}
                                    res = forward_connection_stream(client_stream, tunneled) => {
                                        if let Err(e) = res {
                                            eprintln!("forwarding connection error: {e}");
                                        }
                                    }
                                }
                            });
                        }
                        Err(e) => {
                            eprintln!("failed to accept forwarded connection: {e}");
                            tokio::time::sleep(Duration::from_millis(100)).await;
                        }
                    }
                }
            }
        }
    });

    Ok((local_port, cancellation_token))
}
