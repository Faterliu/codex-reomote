export function extractDownloadableHostFilePaths(body: string) {
  const matches = body.match(/(?:^|[\s`(])((?:\/[^\s`"'<>]+)+\.(?:apk|ipa|zip|dmg|pdf|txt|log|json|csv|xlsx|docx|pptx|tar\.gz|tgz))(?:$|[\s`),.])/gi) ?? [];
  const paths = matches
    .map((match) => match.trim().replace(/^[`(]+/, "").replace(/[`),.]+$/, ""))
    .filter((path) => path.startsWith("/"));

  return Array.from(new Set(paths));
}

