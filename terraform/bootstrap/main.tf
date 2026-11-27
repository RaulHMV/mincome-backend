# Lo que necesitan los pipelines antes de crear cualquier otra cosa. Lo aplica
# el workflow Bootstrap con el rol que da el administrador; después, los demás
# workflows usan los roles que se crean aquí.
#
# Rutas de IAM:
# - /mincome/pipeline/: los roles de este stack. Ningún pipeline los puede tocar.
# - /mincome/workload/infra/: los que crea mincome-backend-infra (RDS Proxy, flow logs).
# - /mincome/workload/backend/: los que crea mincome-backend-ci (las Lambdas, el Scheduler).
# Cada pipeline solo administra su ruta, y todo rol que crea lleva el
# permissions boundary (boundary.tf): no puede darle a un rol nuevo más
# permisos que los de ese boundary.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

# El proveedor OIDC de GitHub ya existe: el rol del administrador lo usa para
# llegar hasta aquí.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

locals {
  account   = data.aws_caller_identity.current.account_id
  partition = data.aws_partition.current.partition
  region    = data.aws_region.current.region
  arn       = "arn:${local.partition}"

  ssm_prefix    = "/mincome/${var.environment}"
  pipeline_path = "/mincome/pipeline/"
  ssm_arn       = "${local.arn}:ssm:${local.region}:${local.account}:parameter${local.ssm_prefix}"

  artifacts_bucket = "${var.stack_name}-artifacts-${local.account}-${local.region}"

  # El estado de cada componente: production/<componente>.tfstate.
  state_object = "${local.arn}:s3:::${var.state_bucket}/${var.environment}"
}

data "aws_iam_policy_document" "github_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Solo los jobs de este repo que corren en el GitHub environment, que es
    # donde se piden las aprobaciones.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:${var.environment}"]
    }
  }
}
