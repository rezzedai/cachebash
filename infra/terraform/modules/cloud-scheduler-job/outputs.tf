output "job_name" {
  description = "Scheduler job name"
  value       = google_cloud_scheduler_job.job.name
}

output "job_id" {
  description = "Scheduler job ID"
  value       = google_cloud_scheduler_job.job.id
}
