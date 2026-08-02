from pathlib import Path

path = Path("src/lib/instacomp-learning-server.ts")
text = path.read_text()

old = '''      // A printed serial denominator is stronger evidence than an AI visual
      // parallel guess. When /199 is observed, only checklist identities with
      // serial_run 199 may survive. The registry's official parallel name then
      // becomes authoritative.
      if (targetSerialRun) {
        if (serialRun !== Number(targetSerialRun)) continue;
      } else {
        // Without printed serial evidence, keep the stricter visual-parallel
        // matching behavior and reject numbered checklist identities.
        if (serialRun) continue;

        const registryBase = isBaseParallel(parallelName);
        const targetBase = isBaseParallel(targetParallel);
        if (targetBase !== registryBase) continue;

        if (!targetBase) {
          const offered = new Set(checklistParallelTokens(parallelName));
          if (
            !targetParallelTokens.length ||
            !targetParallelTokens.every((token) => offered.has(token))
          ) {
            continue;
          }
        }
      }
'''

new = '''      // The printed serial denominator narrows the official checklist
      // candidates, but it never authorizes a parallel by itself. The visible
      // parallel/color/finish must also agree with the official checklist row.
      // For example, a blue /199 card cannot resolve to a red /199 identity.
      const registryBase = isBaseParallel(parallelName);
      const targetBase = isBaseParallel(targetParallel);
      const offeredParallelTokens = new Set(
        checklistParallelTokens(parallelName),
      );
      const visualParallelMatches =
        targetParallelTokens.length > 0 &&
        targetParallelTokens.every((token) => offeredParallelTokens.has(token));

      if (targetSerialRun) {
        if (serialRun !== Number(targetSerialRun)) continue;
        if (registryBase || targetBase || !visualParallelMatches) continue;
      } else {
        // Without printed serial evidence, reject numbered checklist identities
        // and retain the same strict visual parallel compatibility requirement.
        if (serialRun) continue;
        if (targetBase !== registryBase) continue;
        if (!targetBase && !visualParallelMatches) continue;
      }
'''

if text.count(old) != 1:
    raise SystemExit(f"Expected one legacy serial-authority block; found {text.count(old)}")

path.write_text(text.replace(old, new, 1))
print("Installed deterministic serial + visible parallel checklist gate.")
