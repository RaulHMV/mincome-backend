/**
 * Un rol se identifica por cuenta y nombre. La firma IAM de una Lambda llega
 * como `arn:aws:sts::<cuenta>:assumed-role/<rol>/<sesión>`, sin el path del
 * rol, así que el path se ignora también en el ARN configurado.
 */
export function roleKeyOfRoleArn(roleArn: string): string | null {
  const match = /^arn:aws[a-z-]*:iam::(\d{12}):role\/(?:[^/]+\/)*([^/]+)$/.exec(
    roleArn,
  );
  return match ? `${match[1]}/${match[2]}` : null;
}

export function roleKeyOfAssumedRoleArn(callerArn: string): string | null {
  const match =
    /^arn:aws[a-z-]*:sts::(\d{12}):assumed-role\/([^/]+)\/[^/]+$/.exec(
      callerArn,
    );
  return match ? `${match[1]}/${match[2]}` : null;
}
