// Positive control for rule S3: an identifier-argument expression compared to a non-literal.
export function s3Violation(args: { target: string }, caller: string): boolean {
  return args.target === caller;
}
