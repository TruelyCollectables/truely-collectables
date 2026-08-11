from pathlib import Path

runtime = Path('src/lib/instacomp-teacher-runtime-status.ts')
s = runtime.read_text()
bad = '''  const votingTeacherCount = [
    geminiConfigured,
    directGeminiConfigured,
    gatewayGeminiConfigured,
    anthropicConfigured,
'''
good = '''  const votingTeacherCount = [
    geminiConfigured,
    anthropicConfigured,
'''
if bad not in s:
    raise SystemExit('Expected accidental Gemini double-count block not found')
s = s.replace(bad, good, 1)
ret = '''  return {
    geminiConfigured,
    anthropicConfigured,
'''
ret_fixed = '''  return {
    geminiConfigured,
    directGeminiConfigured,
    gatewayGeminiConfigured,
    anthropicConfigured,
'''
if ret not in s:
    raise SystemExit('Runtime return block anchor missing')
s = s.replace(ret, ret_fixed, 1)
runtime.write_text(s)
