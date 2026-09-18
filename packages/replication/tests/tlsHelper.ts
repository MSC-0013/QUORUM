import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface TestTlsMaterial {
  caCert: string;
  serverCert: string;
  serverKey: string;
  clientCert: string;
  clientKey: string;
  untrustedCert: string;
  untrustedKey: string;
}

const OPENSSL = 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe';

export function generateTestTlsMaterial(outDir: string): TestTlsMaterial {
  fs.mkdirSync(outDir, { recursive: true });

  const caKeyPath = path.join(outDir, 'ca-key.pem');
  const caCertPath = path.join(outDir, 'ca-cert.pem');
  const serverKeyPath = path.join(outDir, 'server-key.pem');
  const serverCsrPath = path.join(outDir, 'server.csr');
  const serverCertPath = path.join(outDir, 'server-cert.pem');
  const clientKeyPath = path.join(outDir, 'client-key.pem');
  const clientCsrPath = path.join(outDir, 'client.csr');
  const clientCertPath = path.join(outDir, 'client-cert.pem');
  const untrustedKeyPath = path.join(outDir, 'untrusted-key.pem');
  const untrustedCertPath = path.join(outDir, 'untrusted-cert.pem');

  // 1. Root CA
  execSync(
    `"${OPENSSL}" req -x509 -newkey rsa:2048 -days 1 -nodes -keyout "${caKeyPath}" -out "${caCertPath}" -subj "/CN=QuorumTestCA"`,
    { stdio: 'ignore' }
  );

  // 2. Server Key & Cert signed by CA
  execSync(
    `"${OPENSSL}" req -newkey rsa:2048 -nodes -keyout "${serverKeyPath}" -out "${serverCsrPath}" -subj "/CN=localhost"`,
    { stdio: 'ignore' }
  );
  execSync(
    `"${OPENSSL}" x509 -req -in "${serverCsrPath}" -CA "${caCertPath}" -CAkey "${caKeyPath}" -CAcreateserial -out "${serverCertPath}" -days 1`,
    { stdio: 'ignore' }
  );

  // 3. Client Key & Cert signed by CA
  execSync(
    `"${OPENSSL}" req -newkey rsa:2048 -nodes -keyout "${clientKeyPath}" -out "${clientCsrPath}" -subj "/CN=QuorumNodeClient"`,
    { stdio: 'ignore' }
  );
  execSync(
    `"${OPENSSL}" x509 -req -in "${clientCsrPath}" -CA "${caCertPath}" -CAkey "${caKeyPath}" -CAcreateserial -out "${clientCertPath}" -days 1`,
    { stdio: 'ignore' }
  );

  // 4. Untrusted self-signed cert
  execSync(
    `"${OPENSSL}" req -x509 -newkey rsa:2048 -days 1 -nodes -keyout "${untrustedKeyPath}" -out "${untrustedCertPath}" -subj "/CN=UntrustedClient"`,
    { stdio: 'ignore' }
  );

  return {
    caCert: fs.readFileSync(caCertPath, 'utf8'),
    serverCert: fs.readFileSync(serverCertPath, 'utf8'),
    serverKey: fs.readFileSync(serverKeyPath, 'utf8'),
    clientCert: fs.readFileSync(clientCertPath, 'utf8'),
    clientKey: fs.readFileSync(clientKeyPath, 'utf8'),
    untrustedCert: fs.readFileSync(untrustedCertPath, 'utf8'),
    untrustedKey: fs.readFileSync(untrustedKeyPath, 'utf8')
  };
}
