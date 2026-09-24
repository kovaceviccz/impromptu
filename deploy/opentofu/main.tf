data "cloudflare_ip_ranges" "proxy" {}

locals {
  cloudflare_zone_settings = {
    always_use_https = "on"
    min_tls_version  = "1.2"
    ssl              = "strict"
    tls_1_3          = "on"
    websockets       = "on"
  }
}

resource "cloudflare_zone_setting" "managed" {
  for_each = local.cloudflare_zone_settings

  zone_id    = var.cloudflare_zone_id
  setting_id = each.key
  value      = each.value
}

resource "cloudflare_origin_ca_certificate" "origin" {
  csr                = var.origin_csr
  hostnames          = [var.app_hostname, var.livekit_hostname]
  request_type       = "origin-rsa"
  requested_validity = 5475

  lifecycle {
    create_before_destroy = true
  }
}

resource "hcloud_ssh_key" "deploy" {
  name       = "${var.server_name}-deploy"
  public_key = var.ssh_public_key
}

resource "hcloud_firewall" "server" {
  name = "${var.server_name}-firewall"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.ssh_source_cidrs
  }

  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "443"
    source_ips = concat(
      data.cloudflare_ip_ranges.proxy.ipv4_cidrs,
      data.cloudflare_ip_ranges.proxy.ipv6_cidrs,
    )
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "7881"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "7882"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "3478"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_server" "app" {
  name         = var.server_name
  image        = "ubuntu-24.04"
  server_type  = var.server_type
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.deploy.id]
  firewall_ids = [hcloud_firewall.server.id]
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    ssh_public_key = var.ssh_public_key
  })

  labels = {
    application = "impromptu"
    managed_by  = "opentofu"
  }
}

resource "cloudflare_dns_record" "app" {
  zone_id = var.cloudflare_zone_id
  name    = var.app_hostname
  content = hcloud_server.app.ipv4_address
  type    = "A"
  proxied = true
  ttl     = 1
}

resource "cloudflare_dns_record" "livekit" {
  zone_id = var.cloudflare_zone_id
  name    = var.livekit_hostname
  content = hcloud_server.app.ipv4_address
  type    = "A"
  proxied = true
  ttl     = 1
}
