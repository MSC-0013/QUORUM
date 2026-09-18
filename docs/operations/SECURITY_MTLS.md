# Operational Security: Mutual TLS (mTLS) & Identity Hardening

## Overview

In production Quorum Lab clusters, all inter-node gRPC communications (replication, Raft consensus, Merkle anti-entropy, and fault injection) and control-plane commands require **Mutual TLS (mTLS)**.

mTLS guarantees:
1. **Confidentiality & Integrity**: Wire traffic is encrypted with TLS 1.3.
2. **Mutual Authentication**: The server authenticates the client certificate, and the client authenticates the server certificate against a trusted Cluster Root CA.
3. **Node Identity Enforcement**: Only pods presenting a certificate signed by the Cluster CA with Subject Alternative Name (SAN) matching their node ID or DNS name are permitted to participate in consensus and mutation replication.

---

## 1. Certificate Architecture

```
                 +-------------------+
                 |  Cluster Root CA  |
                 +---------+---------+
                           |
         +-----------------+-----------------+
         |                                   |
+--------v---------+               +---------v--------+
| Node 0 Cert/Key  |               | Node 1 Cert/Key  |
| SAN: quorum-node-0               | SAN: quorum-node-1
+------------------+               +------------------+
```

### Certificate Parameters
- **Key Algorithm**: ECDSA (P-256) or RSA 4096-bit.
- **Validity**: 90 days with automated 30-day rotation via cert-manager.
- **Extended Key Usage (EKU)**: `serverAuth`, `clientAuth`.

---

## 2. Integration with Kubernetes cert-manager

```yaml
apiVersion: cert-manager.io/v1
kind: Issuer
metadata:
  name: quorum-ca-issuer
  namespace: quorum-lab
spec:
  ca:
    secretName: quorum-root-ca-secret
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: quorum-node-tls
  namespace: quorum-lab
spec:
  secretName: quorum-node-tls-secret
  issuerRef:
    name: quorum-ca-issuer
  dnsNames:
    - "*.quorum-node-headless.quorum-lab.svc.cluster.local"
    - "quorum-node"
    - "localhost"
```

---

## 3. Node Configuration

Each `quorum-node` loads the certificate pair and CA certificate from mounted secret volumes:
- `/etc/quorum/tls/tls.crt`
- `/etc/quorum/tls/tls.key`
- `/etc/quorum/tls/ca.crt`

The node initializes its gRPC server with:
```typescript
grpc.ServerCredentials.createSsl(
  caCertBuffer,
  [{ cert_chain: serverCertBuffer, private_key: serverKeyBuffer }],
  true // checkClientCertificate = true (enforces mTLS)
);
```

And initializes peer client connections with:
```typescript
grpc.credentials.createSsl(caCertBuffer, clientKeyBuffer, clientCertBuffer);
```
Attempts by unauthorized or unsigned nodes to connect fail with SSL handshake errors (`UNAUTHENTICATED` / `CERT_VERIFICATION_FAILED`).
