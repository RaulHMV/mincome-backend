# El máximo que puede llegar a tener cualquier rol que creen los pipelines:
# las Lambdas, el RDS Proxy, los flow logs y el Scheduler. Aunque un pipeline
# escriba una política con "*", el rol no pasa de esto.
data "aws_iam_policy_document" "workload_boundary" {
  statement {
    sid = "Logs"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
    ]
    resources = ["*"]
  }

  statement {
    sid = "Tracing"
    actions = [
      "xray:PutTraceSegments",
      "xray:PutTelemetryRecords",
      "xray:GetSamplingRules",
      "xray:GetSamplingTargets",
      "xray:GetSamplingStatisticSummaries",
    ]
    resources = ["*"]
  }

  statement {
    sid = "LambdaInVpc"
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface",
      "ec2:AssignPrivateIpAddresses",
      "ec2:UnassignPrivateIpAddresses",
      "ec2:DescribeSubnets",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeVpcs",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "DatabaseWithIam"
    actions   = ["rds-db:connect"]
    resources = ["${local.arn}:rds-db:${local.region}:${local.account}:dbuser:*/*"]
  }

  statement {
    sid     = "ReadOwnSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      "${local.arn}:secretsmanager:${local.region}:${local.account}:secret:rds!*",
      "${local.arn}:secretsmanager:${local.region}:${local.account}:secret:mincome/${var.environment}/*",
    ]
  }

  statement {
    sid       = "DecryptSecretsThroughSecretsManager"
    actions   = ["kms:Decrypt"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${local.region}.amazonaws.com"]
    }
  }

  statement {
    sid     = "InvokeBackend"
    actions = ["lambda:InvokeFunction"]
    resources = [
      "${local.arn}:lambda:${local.region}:${local.account}:function:${var.stack_name}*",
    ]
  }

  statement {
    sid       = "DeadLetterQueue"
    actions   = ["sqs:SendMessage"]
    resources = ["${local.arn}:sqs:${local.region}:${local.account}:${var.stack_name}*"]
  }
}

resource "aws_iam_policy" "workload_boundary" {
  name        = "mincome-workload-boundary"
  path        = "/mincome/"
  description = "Permissions boundary for every role the Mincome pipelines create."
  policy      = data.aws_iam_policy_document.workload_boundary.json
}
