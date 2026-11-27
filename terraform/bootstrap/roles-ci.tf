# mincome-backend-ci: despliega la app. Corre Terraform del componente
# backend (las Lambdas, el HTTP API, el Scheduler y las alarmas) y los pasos de
# después: subir el paquete, invocar una versión nueva y mover el alias live.
# No puede tocar la red, la base ni Cognito.

locals {
  backend_function_arn = "${local.arn}:lambda:${local.region}:${local.account}:function:${var.stack_name}"
  backend_role_arn     = "${local.arn}:iam::${local.account}:role/mincome/workload/backend/*"
  backend_logs_arn     = "${local.arn}:logs:${local.region}:${local.account}:log-group"
}

data "aws_iam_policy_document" "ci" {
  statement {
    sid       = "StateList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.state.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${var.environment}/backend.tfstate*"]
    }
  }

  # El estado y su lock (use_lockfile).
  statement {
    sid       = "StateObject"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${local.state_object}/backend.tfstate*"]
  }

  statement {
    sid       = "UploadPackages"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:GetObjectVersion"]
    resources = ["${aws_s3_bucket.artifacts.arn}/backend/*"]
  }

  statement {
    sid       = "ListPackages"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.artifacts.arn]
  }

  statement {
    sid = "Functions"
    actions = [
      "lambda:AddPermission",
      "lambda:CreateAlias",
      "lambda:CreateFunction",
      "lambda:DeleteAlias",
      "lambda:DeleteFunction",
      "lambda:DeleteFunctionConcurrency",
      "lambda:GetAlias",
      "lambda:GetFunction",
      "lambda:GetFunctionCodeSigningConfig",
      "lambda:GetFunctionConcurrency",
      "lambda:GetFunctionConfiguration",
      "lambda:GetFunctionRecursionConfig",
      "lambda:GetPolicy",
      "lambda:GetRuntimeManagementConfig",
      "lambda:InvokeFunction",
      "lambda:ListTags",
      "lambda:ListVersionsByFunction",
      "lambda:PublishVersion",
      "lambda:PutFunctionConcurrency",
      "lambda:RemovePermission",
      "lambda:TagResource",
      "lambda:UntagResource",
      "lambda:UpdateAlias",
      "lambda:UpdateFunctionCode",
      "lambda:UpdateFunctionConfiguration",
    ]
    resources = [
      "${local.backend_function_arn}*",
    ]
  }

  # Lambda en la VPC: Terraform revisa las subredes y espera a que se borren
  # sus interfaces de red.
  statement {
    sid = "VpcLookups"
    actions = [
      "ec2:DescribeNetworkInterfaces",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeSubnets",
      "ec2:DescribeVpcs",
    ]
    resources = ["*"]
  }

  # Los roles de las Lambdas y del Scheduler, con el boundary obligatorio.
  statement {
    sid       = "CreateBoundedRoles"
    actions   = ["iam:CreateRole", "iam:PutRolePolicy", "iam:PutRolePermissionsBoundary"]
    resources = [local.backend_role_arn]

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
    resources = [local.backend_role_arn]
  }

  statement {
    sid       = "PassOwnRoles"
    actions   = ["iam:PassRole"]
    resources = [local.backend_role_arn]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com", "scheduler.amazonaws.com"]
    }
  }

  statement {
    sid       = "NeverDropTheBoundary"
    effect    = "Deny"
    actions   = ["iam:DeleteRolePermissionsBoundary"]
    resources = ["*"]
  }

  # API Gateway no tiene nombres en sus ARN.
  statement {
    sid     = "HttpApi"
    actions = ["apigateway:DELETE", "apigateway:GET", "apigateway:PATCH", "apigateway:POST", "apigateway:PUT"]
    resources = [
      "${local.arn}:apigateway:${local.region}::/apis",
      "${local.arn}:apigateway:${local.region}::/apis/*",
      "${local.arn}:apigateway:${local.region}::/tags/*",
    ]
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
      "${local.backend_logs_arn}:/aws/lambda/${var.stack_name}*",
      "${local.backend_logs_arn}:/aws/apigateway/${var.stack_name}*",
    ]
  }

  # Los access logs del HTTP API y DescribeLogGroups no aceptan un recurso concreto.
  statement {
    sid = "ApiAccessLogDelivery"
    actions = [
      "logs:CreateLogDelivery",
      "logs:DeleteLogDelivery",
      "logs:DescribeLogGroups",
      "logs:DescribeResourcePolicies",
      "logs:GetLogDelivery",
      "logs:ListLogDeliveries",
      "logs:PutResourcePolicy",
      "logs:UpdateLogDelivery",
    ]
    resources = ["*"]
  }

  statement {
    sid = "DailySchedule"
    actions = [
      "scheduler:CreateSchedule",
      "scheduler:DeleteSchedule",
      "scheduler:GetSchedule",
      "scheduler:ListTagsForResource",
      "scheduler:TagResource",
      "scheduler:UntagResource",
      "scheduler:UpdateSchedule",
    ]
    resources = ["${local.arn}:scheduler:${local.region}:${local.account}:schedule/default/${var.stack_name}*"]
  }

  statement {
    sid = "DeadLetterQueue"
    actions = [
      "sqs:CreateQueue",
      "sqs:DeleteQueue",
      "sqs:GetQueueAttributes",
      "sqs:GetQueueUrl",
      "sqs:ListQueueTags",
      "sqs:SetQueueAttributes",
      "sqs:TagQueue",
      "sqs:UntagQueue",
    ]
    resources = ["${local.arn}:sqs:${local.region}:${local.account}:${var.stack_name}*"]
  }

  statement {
    sid = "AlarmTopic"
    actions = [
      "sns:CreateTopic",
      "sns:DeleteTopic",
      "sns:GetSubscriptionAttributes",
      "sns:GetTopicAttributes",
      "sns:ListSubscriptionsByTopic",
      "sns:ListTagsForResource",
      "sns:SetTopicAttributes",
      "sns:Subscribe",
      "sns:TagResource",
      "sns:Unsubscribe",
      "sns:UntagResource",
    ]
    resources = ["${local.arn}:sns:${local.region}:${local.account}:${var.stack_name}*"]
  }

  # El tema de alarmas se cifra con la llave administrada aws/sns.
  statement {
    sid       = "DescribeManagedKeys"
    actions   = ["kms:DescribeKey"]
    resources = ["${local.arn}:kms:${local.region}:${local.account}:key/*"]
  }

  statement {
    sid = "Alarms"
    actions = [
      "cloudwatch:DeleteAlarms",
      "cloudwatch:DescribeAlarms",
      "cloudwatch:ListTagsForResource",
      "cloudwatch:PutMetricAlarm",
      "cloudwatch:TagResource",
      "cloudwatch:UntagResource",
    ]
    resources = ["${local.arn}:cloudwatch:${local.region}:${local.account}:alarm:${var.stack_name}*"]
  }

  # Lee lo que publicaron los demás componentes y publica la URL del API.
  statement {
    sid       = "ReadInfraParameters"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:ListTagsForResource"]
    resources = ["${local.ssm_arn}/*"]
  }

  statement {
    sid = "WriteBackendParameters"
    actions = [
      "ssm:AddTagsToResource",
      "ssm:DeleteParameter",
      "ssm:PutParameter",
      "ssm:RemoveTagsFromResource",
    ]
    resources = ["${local.ssm_arn}/backend/*"]
  }

  statement {
    sid       = "DescribeParameters"
    actions   = ["ssm:DescribeParameters"]
    resources = ["*"]
  }

  # La llave de idempotencia va a la configuración de la Lambda.
  statement {
    sid       = "ReadIdempotencyKeys"
    actions   = ["secretsmanager:DescribeSecret", "secretsmanager:GetSecretValue"]
    resources = ["${local.arn}:secretsmanager:${local.region}:${local.account}:secret:mincome/${var.environment}/backend/*"]
  }
}

resource "aws_iam_role" "ci" {
  name                 = "${var.stack_name}-ci"
  path                 = local.pipeline_path
  description          = "GitHub Actions: deploys the mincome-backend app (Terraform backend component)."
  assume_role_policy   = data.aws_iam_policy_document.github_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "ci" {
  name   = "deploy-backend"
  role   = aws_iam_role.ci.id
  policy = data.aws_iam_policy_document.ci.json
}
