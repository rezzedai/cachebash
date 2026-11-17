terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.10"
    }
  }

  backend "gcs" {
    # Bucket configured via: terraform init -backend-config="bucket=tenant-grid-terraform-state"
    prefix = "envs/tenant-grid"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
