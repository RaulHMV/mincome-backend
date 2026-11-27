# Una VPC solo con subredes privadas: la Lambda, el RDS Proxy y RDS no
# necesitan salir a internet (la Lambda de mincome-ai-wrapper vive fuera). Sin
# NAT Gateway no hay costo fijo.

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  name = "mincome-${var.environment}"
  # Dos zonas: RDS lo pide para su grupo de subredes y la Lambda aguanta que
  # se caiga una.
  zones        = slice(data.aws_availability_zones.available.names, 0, 2)
  ssm_prefix   = "/mincome/${var.environment}/network"
  boundary_arn = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:policy/mincome/mincome-workload-boundary"
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = local.name
  }
}

resource "aws_subnet" "private" {
  count = length(local.zones)

  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone       = local.zones[count.index]
  map_public_ip_on_launch = false

  tags = {
    Name = "${local.name}-private-${local.zones[count.index]}"
    Tier = "private"
  }
}

# Solo la ruta local: nada sale de la VPC.
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${local.name}-private"
  }
}

resource "aws_route_table_association" "private" {
  count = length(aws_subnet.private)

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# El security group por omisión sin reglas, para que nadie lo use por descuido.
resource "aws_default_security_group" "default" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${local.name}-default-unused"
  }
}

# Flow logs del tráfico rechazado: muestra intentos de conexión bloqueados sin
# pagar por registrar todo.
resource "aws_cloudwatch_log_group" "flow_logs" {
  name              = "/mincome/${var.environment}/vpc-flow-logs"
  retention_in_days = var.flow_logs_retention_days
}

data "aws_iam_policy_document" "flow_logs_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "flow_logs" {
  name                 = "${local.name}-vpc-flow-logs"
  path                 = "/mincome/workload/infra/"
  assume_role_policy   = data.aws_iam_policy_document.flow_logs_trust.json
  permissions_boundary = local.boundary_arn
}

data "aws_iam_policy_document" "flow_logs" {
  statement {
    actions = [
      "logs:CreateLogStream",
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.flow_logs.arn}:*"]
  }
}

resource "aws_iam_role_policy" "flow_logs" {
  name   = "write-flow-logs"
  role   = aws_iam_role.flow_logs.id
  policy = data.aws_iam_policy_document.flow_logs.json
}

resource "aws_flow_log" "main" {
  vpc_id                   = aws_vpc.main.id
  traffic_type             = "REJECT"
  log_destination_type     = "cloud-watch-logs"
  log_destination          = aws_cloudwatch_log_group.flow_logs.arn
  iam_role_arn             = aws_iam_role.flow_logs.arn
  max_aggregation_interval = 600
}

# Lo que leen los demás componentes.
resource "aws_ssm_parameter" "vpc_id" {
  name  = "${local.ssm_prefix}/vpc-id"
  type  = "String"
  value = aws_vpc.main.id
}

resource "aws_ssm_parameter" "private_subnet_ids" {
  name  = "${local.ssm_prefix}/private-subnet-ids"
  type  = "StringList"
  value = join(",", aws_subnet.private[*].id)
}
