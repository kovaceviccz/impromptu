output "server_ipv4" {
  description = "Public server address used for deployment and direct WebRTC media."
  value       = hcloud_server.app.ipv4_address
}

output "server_type" {
  description = "Provisioned Hetzner server type."
  value       = hcloud_server.app.server_type
}

output "server_location" {
  description = "Provisioned Hetzner location."
  value       = hcloud_server.app.location
}

output "application_url" {
  value = "https://${var.app_hostname}"
}

output "livekit_url" {
  value = "wss://${var.livekit_hostname}"
}

output "origin_certificate" {
  description = "Cloudflare Origin CA certificate to install beside the local private key."
  value       = cloudflare_origin_ca_certificate.origin.certificate
}
