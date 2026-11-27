output "ci_role_arn" {
  description = "GitHub environment variable AWS_CI_ROLE_ARN."
  value       = aws_iam_role.ci.arn
}

output "infra_role_arn" {
  description = "GitHub environment variable AWS_INFRA_ROLE_ARN."
  value       = aws_iam_role.infra.arn
}

output "artifacts_bucket" {
  description = "Where the pipeline uploads the Lambda packages."
  value       = aws_s3_bucket.artifacts.bucket
}

output "state_bucket" {
  value = aws_s3_bucket.state.bucket
}

output "workload_boundary_arn" {
  value = aws_iam_policy.workload_boundary.arn
}
