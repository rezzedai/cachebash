terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    # Bucket configured via: terraform init -backend-config="bucket=<project>-terraform-state"
    prefix = "envs/cachebash-app"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
