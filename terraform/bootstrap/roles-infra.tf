# mincome-backend-infra: corre Terraform de los componentes network, database,
# secrets y auth. No puede tocar las Lambdas ni a los roles de los pipelines.

locals {
  infra_components = ["network", "database", "secrets", "auth"]
  rds_arn          = "${local.arn}:rds:${local.region}:${local.account}"
  infra_role_arn   = "${local.arn}:iam::${local.account}:role/mincome/workload/infra/*"
  infra_logs_arn   = "${local.arn}:logs:${local.region}:${local.account}:log-group"
  region_condition = {
    test     = "StringEquals"
    variable = "aws:RequestedRegion"
    values   = [local.region]
  }
}

data "aws_iam_policy_document" "infra" {
  statement {
    sid       = "StateList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.state.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = [for component in local.infra_components : "${var.environment}/${component}.tfstate*"]
    }
  }

  statement {
    sid       = "StateObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = [for component in local.infra_components : "${local.state_object}/${component}.tfstate*"]
  }

  # VPC, subredes, tablas de rutas, security groups y flow logs. Crear casi no
  # acepta un ARN concreto; se limita a la región.
  statement {
    sid = "Network"
    actions = [
      "ec2:AssociateRouteTable",
      "ec2:AuthorizeSecurityGroupEgress",
      "ec2:AuthorizeSecurityGroupIngress",
      "ec2:CreateFlowLogs",
      "ec2:CreateRouteTable",
      "ec2:CreateSecurityGroup",
      "ec2:CreateSubnet",
      "ec2:CreateTags",
      "ec2:CreateVpc",
      "ec2:DeleteTags",
      "ec2:DescribeAccountAttributes",
      "ec2:DescribeAvailabilityZones",
      "ec2:DescribeFlowLogs",
      "ec2:DescribeNetworkAcls",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DescribePrefixLists",
      "ec2:DescribeRouteTables",
      "ec2:DescribeSecurityGroupRules",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeSubnets",
      "ec2:DescribeTags",
      "ec2:DescribeVpcAttribute",
      "ec2:DescribeVpcs",
      "ec2:DisassociateRouteTable",
      "ec2:ModifySecurityGroupRules",
      "ec2:RevokeSecurityGroupEgress",
      "ec2:RevokeSecurityGroupIngress",
      "ec2:UpdateSecurityGroupRuleDescriptionsEgress",
      "ec2:UpdateSecurityGroupRuleDescriptionsIngress",
    ]
    resources = ["*"]

    condition {
      test     = local.region_condition.test
      variable = local.region_condition.variable
      values   = local.region_condition.values
    }
  }

  # Borrar o cambiar la VPC solo si es de Mincome (default_tags de cada
  # componente): no puede tocar otras redes de la cuenta.
  statement {
    sid = "DeleteOnlyMincomeNetwork"
    actions = [
      "ec2:DeleteFlowLogs",
      "ec2:DeleteRouteTable",
      "ec2:DeleteSecurityGroup",
      "ec2:DeleteSubnet",
      "ec2:DeleteVpc",
      "ec2:ModifySubnetAttribute",
      "ec2:ModifyVpcAttribute",
    ]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Service"
      values   = ["mincome"]
    }

    condition {
      test     = local.region_condition.test
      variable = local.region_condition.variable
      values   = local.region_condition.values
    }
  }

  # La instancia, su grupo de subredes y sus snapshots, por nombre. Crear una
  # instancia también toca los grupos de opciones y de parámetros por omisión.
  statement {
    sid = "DatabaseInstance"
    actions = [
      "rds:AddTagsToResource",
      "rds:CreateDBInstance",
      "rds:CreateDBSnapshot",
      "rds:CreateDBSubnetGroup",
      "rds:DeleteDBInstance",
      "rds:DeleteDBSubnetGroup",
      "rds:DescribeDBInstances",
      "rds:DescribeDBSnapshots",
      "rds:DescribeDBSubnetGroups",
      "rds:ListTagsForResource",
      "rds:ModifyDBInstance",
      "rds:ModifyDBSubnetGroup",
      "rds:RemoveTagsFromResource",
    ]
    resources = [
      "${local.rds_arn}:db:mincome-*",
      "${local.rds_arn}:subgrp:mincome-*",
      "${local.rds_arn}:snapshot:mincome-*",
      "${local.rds_arn}:og:*",
      "${local.rds_arn}:pg:*",
      "${local.rds_arn}:secgrp:*",
    ]
  }

  # Los ARN del proxy y de su grupo de destino son ids, no nombres.
  statement {
    sid = "DatabaseProxy"
    actions = [
      "rds:AddTagsToResource",
      "rds:CreateDBProxy",
      "rds:DeleteDBProxy",
      "rds:DeregisterDBProxyTargets",
      "rds:DescribeDBProxies",
      "rds:DescribeDBProxyTargetGroups",
      "rds:DescribeDBProxyTargets",
      "rds:ListTagsForResource",
      "rds:ModifyDBProxy",
      "rds:ModifyDBProxyTargetGroup",
      "rds:RegisterDBProxyTargets",
      "rds:RemoveTagsFromResource",
    ]
    resources = [
      "${local.rds_arn}:db-proxy:*",
      "${local.rds_arn}:target-group:*",
      "${local.rds_arn}:db:mincome-*",
    ]
  }

  statement {
    sid = "DatabaseCatalog"
    actions = [
      "rds:DescribeDBEngineVersions",
      "rds:DescribeOrderableDBInstanceOptions",
    ]
    resources = ["*"]
  }

  # La primera instancia de RDS de la cuenta crea su rol de servicio.
  statement {
    sid       = "RdsServiceLinkedRole"
    actions   = ["iam:CreateServiceLinkedRole"]
    resources = ["${local.arn}:iam::${local.account}:role/aws-service-role/rds.amazonaws.com/AWSServiceRoleForRDS"]

    condition {
      test     = "StringEquals"
      variable = "iam:AWSServiceName"
      values   = ["rds.amazonaws.com"]
    }
  }

  # La contraseña maestra la guarda RDS en Secrets Manager (secretos rds!…);
  # quien crea la instancia necesita esto (docs de RDS, "Permissions required
  # for Secrets Manager integration").
  statement {
    sid = "RdsManagedMasterSecret"
    actions = [
      "secretsmanager:CreateSecret",
      "secretsmanager:DeleteSecret",
      "secretsmanager:DescribeSecret",
      "secretsmanager:TagResource",
    ]
    resources = ["${local.arn}:secretsmanager:${local.region}:${local.account}:secret:rds!*"]
  }

  # Para describir aws/secretsmanager, la llave del secreto maestro.
  statement {
    sid       = "DescribeManagedKeys"
    actions   = ["kms:DescribeKey"]
    resources = ["${local.arn}:kms:${local.region}:${local.account}:key/*"]
  }

  # El componente secrets: la llave de idempotencia. GetSecretValue lo usa
  # Terraform al refrescar la versión.
  statement {
    sid = "AppSecrets"
    actions = [
      "secretsmanager:CreateSecret",
      "secretsmanager:DeleteSecret",
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetResourcePolicy",
      "secretsmanager:GetSecretValue",
      "secretsmanager:ListSecretVersionIds",
      "secretsmanager:PutSecretValue",
      "secretsmanager:TagResource",
      "secretsmanager:UntagResource",
      "secretsmanager:UpdateSecret",
    ]
    resources = ["${local.arn}:secretsmanager:${local.region}:${local.account}:secret:mincome/${var.environment}/*"]
  }

  # Roles del RDS Proxy y de los flow logs, con el boundary obligatorio.
  statement {
    sid       = "CreateBoundedRoles"
    actions   = ["iam:CreateRole", "iam:PutRolePolicy", "iam:PutRolePermissionsBoundary"]
    resources = [local.infra_role_arn]

    condition {
      test     = "StringEquals"
      variable = "iam:PermissionsBoundary"
      values   = [aws_iam_policy.workload_boundary.arn]
    }
  }

  statement {
    sid = "ManageOwnRoles"
    actions = [
      "iam:DeleteRole",
      "iam:DeleteRolePolicy",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:ListRolePolicies",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:UpdateRoleDescription",
    ]
    resources = [local.infra_role_arn]
  }

  statement {
    sid       = "PassOwnRoles"
    actions   = ["iam:PassRole"]
    resources = [local.infra_role_arn]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["rds.amazonaws.com", "vpc-flow-logs.amazonaws.com"]
    }
  }

  statement {
    sid       = "NeverDropTheBoundary"
    effect    = "Deny"
    actions   = ["iam:DeleteRolePermissionsBoundary"]
    resources = ["*"]
  }

  # Los pools no se conocen antes de crearlos.
  statement {
    sid = "Cognito"
    actions = [
      "cognito-idp:CreateGroup",
      "cognito-idp:CreateUserPool",
      "cognito-idp:CreateUserPoolClient",
      "cognito-idp:DeleteGroup",
      "cognito-idp:DeleteUserPool",
      "cognito-idp:DeleteUserPoolClient",
      "cognito-idp:DescribeUserPool",
      "cognito-idp:DescribeUserPoolClient",
      "cognito-idp:GetGroup",
      "cognito-idp:GetUserPoolMfaConfig",
      "cognito-idp:ListTagsForResource",
      "cognito-idp:SetUserPoolMfaConfig",
      "cognito-idp:TagResource",
      "cognito-idp:UntagResource",
      "cognito-idp:UpdateGroup",
      "cognito-idp:UpdateUserPool",
      "cognito-idp:UpdateUserPoolClient",
    ]
    resources = ["${local.arn}:cognito-idp:${local.region}:${local.account}:userpool/*"]
  }

  # El pipeline revisa si ya existe la Lambda para conectarle el trigger de Cognito.
  statement {
    sid       = "FindBackendAlias"
    actions   = ["lambda:GetAlias"]
    resources = ["${local.arn}:lambda:${local.region}:${local.account}:function:${var.stack_name}"]
  }

  # Lo que cada componente publica para los demás.
  statement {
    sid = "Parameters"
    actions = [
      "ssm:AddTagsToResource",
      "ssm:DeleteParameter",
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:ListTagsForResource",
      "ssm:PutParameter",
      "ssm:RemoveTagsFromResource",
    ]
    resources = [for component in local.infra_components : "${local.ssm_arn}/${component}/*"]
  }

  statement {
    sid       = "DescribeParameters"
    actions   = ["ssm:DescribeParameters"]
    resources = ["*"]
  }

  statement {
    sid = "OwnLogGroups"
    actions = [
      "logs:CreateLogGroup",
      "logs:DeleteLogGroup",
      "logs:DeleteRetentionPolicy",
      "logs:ListTagsForResource",
      "logs:PutRetentionPolicy",
      "logs:TagResource",
      "logs:UntagResource",
    ]
    resources = [
      "${local.infra_logs_arn}:/aws/rds/instance/mincome-*",
      "${local.infra_logs_arn}:/mincome/${var.environment}/*",
    ]
  }

  statement {
    sid       = "DescribeLogGroups"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }
}

resource "aws_iam_role" "infra" {
  name                 = "${var.stack_name}-infra"
  path                 = local.pipeline_path
  description          = "GitHub Actions: Terraform for the network, database, secrets and auth components."
  assume_role_policy   = data.aws_iam_policy_document.github_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "infra" {
  name   = "manage-infra"
  role   = aws_iam_role.infra.id
  policy = data.aws_iam_policy_document.infra.json
}
