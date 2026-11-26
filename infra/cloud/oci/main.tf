# Noah's Ark demo server on Oracle Cloud Always Free: network + one A1.Flex VM that sets itself up on first boot.
# Usage: see README.md in this folder.

terraform {
  required_version = ">= 1.6"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 9.15"
    }
  }
}

variable "tenancy_ocid" {
  description = "Tenancy OCID (the `tenancy=` line in ~/.oci/config)."
  type        = string
}

variable "compartment_ocid" {
  description = "Compartment for the resources. Empty = the root compartment (the tenancy)."
  type        = string
  default     = ""
}

variable "region" {
  type    = string
  default = "ap-singapore-1"
}

variable "ssh_public_key_path" {
  description = "Public key that may log in as opc."
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "duckdns_subdomain" {
  description = "The DuckDNS name without .duckdns.org, e.g. khoryz666."
  type        = string
}

variable "duckdns_token" {
  description = "DuckDNS token (top of duckdns.org once logged in). The VM points the name at its own IP on first boot."
  type        = string
  sensitive   = true
}

variable "operator_password" {
  description = "Password that lets Ark Command send commands (open it once with ?key=<this>)."
  type        = string
  sensitive   = true
}

variable "repo_branch" {
  description = "Branch of github.com/zishaan1911/Noah-Ark the VM runs."
  type        = string
  default     = "main"
}

# Always Free allows up to 4 OCPU and 24 GB of A1 in total per tenancy.
variable "ocpus" {
  type    = number
  default = 4
}

variable "memory_gb" {
  type    = number
  default = 24
}

provider "oci" {
  region = var.region # credentials come from ~/.oci/config (oci setup config)
}

locals {
  compartment = var.compartment_ocid != "" ? var.compartment_ocid : var.tenancy_ocid
  domain      = "${var.duckdns_subdomain}.duckdns.org"
  shape       = "VM.Standard.A1.Flex"
}

data "oci_identity_availability_domains" "all" {
  compartment_id = var.tenancy_ocid
}

data "oci_core_images" "ol9" {
  compartment_id           = local.compartment
  operating_system         = "Oracle Linux"
  operating_system_version = "9"
  shape                    = local.shape # only images that run on ARM
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_vcn" "ark" {
  compartment_id = local.compartment
  cidr_blocks    = ["10.0.0.0/16"]
  display_name   = "noah-ark-demo-vcn"
  dns_label      = "noahark"
}

resource "oci_core_internet_gateway" "ark" {
  compartment_id = local.compartment
  vcn_id         = oci_core_vcn.ark.id
  display_name   = "noah-ark-demo-igw"
}

resource "oci_core_route_table" "ark" {
  compartment_id = local.compartment
  vcn_id         = oci_core_vcn.ark.id
  display_name   = "noah-ark-demo-routes"
  route_rules {
    destination       = "0.0.0.0/0"
    network_entity_id = oci_core_internet_gateway.ark.id
  }
}

resource "oci_core_security_list" "ark" {
  compartment_id = local.compartment
  vcn_id         = oci_core_vcn.ark.id
  display_name   = "noah-ark-demo-firewall"

  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
  }

  # SSH, and HTTP/HTTPS for Caddy (HTTP is needed for the Let's Encrypt challenge).
  dynamic "ingress_security_rules" {
    for_each = [22, 80, 443]
    content {
      source   = "0.0.0.0/0"
      protocol = "6" # TCP
      tcp_options {
        min = ingress_security_rules.value
        max = ingress_security_rules.value
      }
    }
  }
}

resource "oci_core_subnet" "ark" {
  compartment_id    = local.compartment
  vcn_id            = oci_core_vcn.ark.id
  cidr_block        = "10.0.0.0/24"
  display_name      = "noah-ark-demo-subnet"
  dns_label         = "public"
  route_table_id    = oci_core_route_table.ark.id
  security_list_ids = [oci_core_security_list.ark.id]
}

resource "oci_core_instance" "ark" {
  compartment_id      = local.compartment
  availability_domain = data.oci_identity_availability_domains.all.availability_domains[0].name # Singapore has one AD
  display_name        = "noah-ark-demo"
  shape               = local.shape

  shape_config {
    ocpus         = var.ocpus
    memory_in_gbs = var.memory_gb
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ol9.images[0].id
    boot_volume_size_in_gbs = 50
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.ark.id
    assign_public_ip = true
  }

  instance_options {
    are_legacy_imds_endpoints_disabled = true
  }

  metadata = {
    ssh_authorized_keys = file(pathexpand(var.ssh_public_key_path))
    user_data = base64encode(templatefile("${path.module}/cloud-init.yaml", {
      domain            = local.domain
      duckdns_subdomain = var.duckdns_subdomain
      duckdns_token     = var.duckdns_token
      operator_password = var.operator_password
      repo_branch       = var.repo_branch
    }))
  }

  lifecycle {
    ignore_changes = [source_details[0].source_id] # a newer OL9 image must not rebuild the server
  }
}

output "public_ip" {
  value = oci_core_instance.ark.public_ip
}

output "ssh" {
  value = "ssh opc@${oci_core_instance.ark.public_ip}"
}

output "setup_log" {
  value = "ssh opc@${oci_core_instance.ark.public_ip} sudo tail -f /var/log/noah-ark-setup.log"
}

output "health_check" {
  value = "curl https://${local.domain}/v1/health"
}

output "mqtt_url" {
  description = "Set this as the MQTT_URL repository variable for the Pages workflow."
  value       = "wss://${local.domain}/mqtt"
}
