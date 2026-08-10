from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PATH = ROOT / "src/lib/instacomp-teacher-market-provider.ts"
text = PATH.read_text(encoding="utf-8")


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one anchor, found {count}: {old[:160]!r}")
    text = text.replace(old, new, 1)


replace_once(
    '''function itemKey(url: string) {\n  return directEbayItemUrl(url) || url;\n}\n\nfunction requiredTeacherVotes(configuredCount: number) {''',
    '''function itemKey(url: string) {\n  return directEbayItemUrl(url) || url;\n}\n\nfunction teacherVoteFamily(teacher: TeacherName) {\n  // Groq Compound and Groq GPT-OSS browser search are distinct discovery\n  // methods, but they share one provider credential and therefore contribute\n  // at most one independent trust vote for any sold listing.\n  if (teacher === "groq" || teacher === "groq_browser") return "groq";\n  return teacher;\n}\n\nfunction requiredTeacherVotes(configuredCount: number) {''',
)

replace_once(
    '''    Array<{ teacher: TeacherName; comp: InstaCompComp }>\n  >();\n  for (const attempt of attempts.filter((row) => row.ok)) {\n    for (const comp of strictTeacherRows(attempt, "sold", ai)) {\n      const key = itemKey(comp.url);\n      const group = byItem.get(key) || [];\n      if (!group.some((row) => row.teacher === attempt.teacher)) {\n        group.push({ teacher: attempt.teacher, comp });\n      }\n      byItem.set(key, group);\n    }\n  }''',
    '''    Array<{ teacher: TeacherName; voteFamily: string; comp: InstaCompComp }>\n  >();\n  for (const attempt of attempts.filter((row) => row.ok)) {\n    const voteFamily = teacherVoteFamily(attempt.teacher);\n    for (const comp of strictTeacherRows(attempt, "sold", ai)) {\n      const key = itemKey(comp.url);\n      const group = byItem.get(key) || [];\n      if (!group.some((row) => row.voteFamily === voteFamily)) {\n        group.push({ teacher: attempt.teacher, voteFamily, comp });\n      }\n      byItem.set(key, group);\n    }\n  }''',
)

replace_once(
    '''  const requiredVotes = requiredTeacherVotes(configuredTeachers.length);\n  const sold = consensusSold(votingAttempts, params.ai, requiredVotes);''',
    '''  const configuredVoteFamilies = new Set(configuredTeachers.map(teacherVoteFamily));\n  const requiredVotes = requiredTeacherVotes(configuredVoteFamilies.size);\n  const sold = consensusSold(votingAttempts, params.ai, requiredVotes);''',
)

PATH.write_text(text, encoding="utf-8")
print("patched Groq provider-family vote dedupe")
