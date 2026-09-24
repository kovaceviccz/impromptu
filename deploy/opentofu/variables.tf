variable "cloudflare_zone_id" {
  description = "Cloudflare zone identifier containing both hostnames."
  type        = string
}

variable "app_hostname" {
  description = "Public application hostname, normally impromptu.social."
  type        = string
}

variable "livekit_hostname" {
  description = "Proxied signaling hostname. It must use the livekit subdomain expected by Envoy."
  type        = string

  validation {
    condition     = startswith(var.livekit_hostname, "livekit.")
    error_message = "livekit_hostname must begin with livekit."
  }
}

variable "origin_csr" {
  description = "PEM-encoded CSR for the Cloudflare Origin CA certificate."
  type        = string
}

variable "server_name" {
  description = "Hetzner server name."
  type        = string
  default     = "impromptu"
}

variable "server_type" {
  description = "Hetzner server type."
  type        = string
  default     = "cpx12"
}

variable "location" {
  description = "Hetzner location."
  type        = string
  default     = "nbg1"
}

variable "ssh_source_cidrs" {
  description = "IPv4 or IPv6 CIDRs allowed to SSH to the server."
  type        = list(string)

  validation {
    condition     = length(var.ssh_source_cidrs) > 0
    error_message = "At least one SSH source CIDR is required."
  }
}

variable "ssh_public_key" {
  description = "OpenSSH public key registered with Hetzner and installed for the deploy user."
  type        = string
}
