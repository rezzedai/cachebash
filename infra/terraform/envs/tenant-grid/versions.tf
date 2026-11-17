terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.10"
    }
  }

  backend "gcs" {
    # Partial config, supplied at init time (values live outside this repo):
    #   terraform init -backend-config="bucket=<state-bucket>" -backend-config="prefix=<state-prefix>"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
