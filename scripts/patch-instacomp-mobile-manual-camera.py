#!/usr/bin/env python3
from __future__ import annotations

import base64
import gzip
import hashlib
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path.cwd()
SCREEN = ROOT / "src/app/index.tsx"
API = ROOT / "src/lib/instacomp-api.ts"

EXPECTED_SCREEN_SHA = "e1a2ad6456d17663e35665b95026b5f0a000842164092231e2ba000e3e773e7e"
PATCHED_SCREEN_SHA = "43c1fae83da17c8fe5d4ecd3798f8d7e260183c3334bc947cd259989310e9b1a"
EXPECTED_API_SHA = "7897ee395767e17dd3af1009d3c2a899dbca14c182401b0409d69bc9735b069b"
PATCHED_API_SHA = "f5759a6a68b04514a9e70f846dc7001f4df3ba52b6b6129017d58e39a9b8f92e"

SCREEN_PAYLOAD = """H4sIAK1Gb2oC/+U87XLbOJL//RRIdmYl7zmyPm3FsZxyHGfj2jjx2Z7J3k6lZiAJsrihSC1J2VY0qpqHuD/39x5tnuS6AZAEQJCiZCd7e+epiUTioxv93Q1AzmTqBxFZkFnITqjr9ung8w4+XLIR/7yKaMTIkowCf0IqAaODqPJiy5HDtgg5HkTOrRPNz7yhM6CRH+zgS5cFEX45m9Abhl+u6Igdw/AfHXbHnweB77rJUzR32dWYMT7omt2LT382GNO+yz5M6QBA4DsxQsPnmUcBBaagRU7ohAUCllgZPl6wYOKEoeN7YbIgdj/1nw14czo+mk9ZMsk1Pti7q2Q488KInviT6dWAepcsnLl8CdOATWnAktYTGgwvxn7kY+Ns6vp0qI1Ml1ar7bpOf9fB1gG0PqNTB2Fy5LDrVcSmpEcqY3/CKuRXUoFxXsS/IRf5l4DdAg1w2ABWHZHXp2+Of3h3/fPJ8fnp5fHPf/vw4RymqNfq3Reyx/nZe7M1aTr+a2Zgsxm3Ki0/X12fXoh5oXkLiQZUGrIRBaqQ0cwDkfE98hYQBzFgzKtucxqKiQR5Qf5gBiGIhyk7j6rezHW3XyS9f5omXN0hAfvHjIVRyuhPYo4M/6swQzpFCJTcISGLkKRyCJf7w5jOR1VBZhXwCGTSu9G6pxIDAzgTtAHIH8F8BPYmedTmCKMApgXm4UKzy8VZ0zlexU/rTBHRz9CcTnKdPqvTVEfUDZk6MOYMHc75wJP0uczAv/n+RBmHj9owi3BqaPvBYHzqoT0YCryVF2Xgn7MwRGuUoiDfaINhFCGVC5cOGInGjDAvcgJGOPMIaKMzFO9vZvBtB796JKJT/i4cz6KIBRWYQwVPPerOvwCNOejj+KkY5zC1I1w0k0cYxnFM2G0xPSbvk2kV3qsaloCHjjSce4NUS/vsxvFwZqmkhDgjUn2Sqt3L2k1AvYgN4/YYViBQ6RF6R50oq5xSCZMpRf/sbNKd1Cj+W01eApcEF0mKCwcC7BpWdtR+CYWIx9gwlCaG0MEABIBEPpkiQQDwdAxtwTCsVZLhnCfiL2DRLPDi5+WW+Jd/aPqcahzRlNR4n7LLaFD0SpELoqtOrroQUzfsc0jZj+n5cIlPSCUNaVU6JP52uaXY9ymQkXGKxOZZBB5VIXogaL0jRdYkhk8Sx1AbzIIAsCS//mq2AcnSt7qwx6MEqol0qUyVzIyCedJsnwPwjoIZi0VBN6JVbNpW2nSCg9QiAdBCU29IIudmHDEPH5GgKH7EwaipVqtVUg0RtJtKogmNyhCkBtiyC2eA9D1GWlZTHfrHjLoQQx2QRqoa4WdnehH4qAUA/4BwQYmbl4Z6ctgva4C5qprROPDvQK3uyGkQ+EG18l5qE/nh8ozc0VASmA1rle1UdfRViSBpeKGtLjd0qvL5OSIahiEPiHq9OBJS0dT1UwMoJ1J6WhWEKwmfg4T0FpZD3rjONOHZDgHy3nj8WQTR+XpimJVEX9KIgROJMOCGsTLRRV9Yal9WrEtAkTHhtmHHYBXRYEyqDNmom3LfZTUmuJtaUsFkqcwgOQ5YmoPKDhHjE8bkk9Nkl0Lnl6RynFBT2CGuKjoxCb2hjqeOO1DHIalWD0sxtTqZipBJsTzFqfBVEh6cewPmj4T0a0vgXWoTsWwdyZSKA3/mDonnJ2aRYyoEnFy4jIIEoDniONcUpAXPRg4EE24Ja8U1O8dcqe4BhWG5Y4Z6GBYLQiVhwQDX7WpxwSY+sMDVFbkwIclpSL7UcAOLA3aQ4/K1kPun+VBjkYi6usavtxSuTg9ZSWrd9IXQ4d9noRrYDAEcbzogzxoQyTaU9SndqlK6lWghdigeu0ehj8X/30gyJflTJlF9oQUC5JxG49qE3qc2wEiJUyMgujpe1ciMd0RL4M+8YZXj8ifSqNe3yS7/MJQ4JYkReYu0gaHf02PvNJGEWIc8SVJCfEpyjdSEF44pE2afOzw+EGYp1EPrE2m2+n40JigcIQFrmEQyIycII1s0nYQAK+IvNWGKA6uiLMNSU0nXomTgybuEEhmHoIfoAk5iefO9ZUSkzZd52tdxF1I4gNJOyEldq2iEsfpszCktrjrL/cpV2hM6Sqxy3Y7GpIw7QbRs8RkKYk5kI+iI4vQeFB6Ymxn7UgZjFSQQWr14+VKNY6YfYtUIhs9d1lvwj7AmnNsJjAanyoLlUUJupdKksCBgo94iCbaXSottXrVd1Ih6C/Gptkz8Ies9nYpY/anSQGeRP/IHs7D31B+N1JYvYPViPNACqtMx7ie5y+wt1EqJ2ol6kFhE7EpYaaXB9xT/0FtUNZNqxHHCh2gpzurAeUW8l0R9j+BA1b+Dx/BjlogdhHqpke8cTH3EdRqox25Nr1RsHCQHcdTL2ACgblSuuRXlpYpU8UGXgwhACs0fQjA/YKj7JiSrAZCzTRBdxRDo+m1zB3GpJcckZIhypLw+VGv/VpX5cMsCl86XRxr8fNV9CzKo6a0cYG4YZATCnAxj2FfAa99bZvr63gXY/BA1Lg51zU5HmUGHuHdhBYMNy6MT/v1wF58y6O+a+B9tmV0sJImcyGU2Y1aME69U41DLCEIw6CCL2ABniWNfQRGsq1k/ygV37t+CqLt+COkZiKbjojpAFMCGoAoeowE4mwiJA+FForQlkTrc5RsHZUg55nJ1BcQHQpJdQxxt89hm4cihvC/J1Hc8MCSnqNtg0D3fY0+PSiCCDv3POI2NnWr/n1SYJ34AErBD1HfX/vQdG0WfMsvZaKpLLFY9xlyvfFC6yWNhJmbLRS7m3GpRFevkmppB6S8M/BeEPWTkzwIR3aJ4hqozGQUg61urpbK0LAndeeP7kc3eWQaApY9m4QX1mLuWKZBO26qdC71Lrt6tAe4t6IUV1rVRrPE9UP077pzhrQeDdwTtvdmkj3KAFR4wGw51LbO5vv8ZpqLBtPb41gLjsUv/zkrmVY6IWObKc0SKKxKRWSZjftbYtg0bOiGPAdWgkRz2zIQ2O9TGGBsvU6yFznwEPQhyXcNq95YP5UfqzuzC+QZUDpPThZJzK8sVmffy+3WE9tsybw3eHfXMTfjH490J977rMG9jxYHwNAp8N3ws5Rlx83iF7nI1/c3KolZGehI/bE5XTHNyPAi3pWpyhinPO/Ra5IPHE1n5MBpVbCt5oGaVJutPVswT+80LPkJ0dqw9lSo0+eMfrQNfS/G2TfCpBBdvfWeo7SRWV2iRihMWwJQCd0leW72zsqQzz7NEjeX5Y5lfEezHEj9bIaWBJbsmF8Cm+LqO9NnxmFBvRmXSc86/50uvNTqzvM2+O9xVc0uljrOrHBnayo5Oa65YmMrUTM0aUlECa6siWfolMDBTY0bwc5g5RKdXVpwvrPfUpcGNVinCPN/1g97TP7T63eZoT23b1STMxqAEIVsSmFTzeCK4Veg1iyfPiuLZECsxo7m64w0x3ZgNPsevpjSAQJu5unXASG/kAIWg14QGn1kEWSLoBmTUtQeg+JEGuPtuYMmj/bRw4k8hAr0bO66I80Uh1fGcEDJSG3C7yNrEVRfF9NSPXgqlDhZBk8YadV4orQ4naTS/DiC0ALcS15aUAdiReeEsfFmLRK83fnAmx3GDgCU9MNe2oZPpFeTgg/FrNnDEkR9gj3+HkHrqSYh4O9/BaicgbOC1Fdf5lMlD3x3iMaaQV4OV9/huKy7j4WaWCkLsYYP1DvEwZ48cBwGd1/DgZKyzeCLhikXV1JfVarWqnSD6bIDHT5+2d/LGic7Fgz6JPZ7t2shxwYBXX/m+y6gXby3E52CCoahuy1EpqtR5WZsDxXe0N/0ANEB/BcEMTpHATZE2IKcNf/cdr1ohlW1eYuR1HsGmkcOGFQ3Die8xkA1SvcXo++WBzLnk4TL0w/G283yKmxq8m3AuomdaQH1JfvnuuwXvUIv8N849RF7N7eUvW0qp9j1ua9xSx0VHmVfOX9cUp+eMcVFoeZNS2ZU2WuzvWK0zqvRWiThJm+l0zvqBf2cGOE9MXU0DJG3cJRcvfbQWGOnmamFXNaW0fvrX45Nrcvb69P312fV/kJMP79+cXZ6fvjar5sCIk+P3r89eH1+fpt1//+0/yeXpj2enH+Hj3384u4SBy/WNrljihUvnmXLGAuV5ylu4ZP7gffb8O4+IV5sDO5FqZoKL1W/zVUgnZV2HbMuwoZhN2IM6eaORN798t1A6LAmkuuAQhzRi279kGXl6TwdR4k3JzAPMffcW9HzFqhc2Ma2urFYJmygdqr0GZaenMiyvJv3eJ4wvB91RSPyA+xksFIGUbJUJVVeDtsfNaRQAlOZ7MNMA69VgHWOUMHhxHcUT18j12AkzU8nN6jvHdflEfTzdwygSmIZooEZOMIEHFH0Xq4u1UitbaM6oFrpAmGp9h3S2IQ6fVqsBb+CJUzWn5PKZzXsL0W9ppZGY3JpW/P7bfxM5FjpPccetuvvz7s0OQT9TdvNg2+iZjfa3l5pmWgVQaGZW8vJ726oQ+Vr/jvatlVXuSN9zr/cAYUQIeaUubli41ZJeODWSmXztQTXnxyTLFa/MfgPCiBKwQhqMJkQUYpi7/1X0OUGV5ynM1yKOjM248CTA7EGa6obA0SgFVWstAUNQdc7DHmnkdJSOTenM67K5vQ/03tZ+28vvf9myDTUCyXV4XygNC4tPjHOdUu6RO6zybpF3z1Ws2c0N41hcYLetUsVta8EonojPY5MgngZU5UqN/tvLkpDzyPHnwBmu2uRU+7/y70vXwuIBeTTEv3f+3YNrXTGc/E2KDBUhe95er8Rrra5/Q0Id37JAP5n2zYhFBeh/MYK9dW7G/wxqjQHuRqTapACrh2SLJ0+USgkEuMxiGHNdGJjt7BIXxoRmjGguyYgRCzc9MqSe0GBu28hLNh+Sy3D5mXgOF9OprVkGP295DAscQ/hi1Fxty1yxpbDOusXxJFFvKFy8/RzU6tWrAKyLvxQ1HrwPvMGylb2ApNazRsE12Q+J78U80h7AGoUnhJtbeLImY7YkWRBYJCJ8nyvcpLKBc+Qc1boes5ARKu+oyHtrTN5Ww3NZVGa2fVEgxztfIsANJtpEvGdykoYfotkRdX9R/ik85YEIaLPdOqED8iC6mEc9bOu2OQCk15W4IrAsoc/YXdp+fgrZGvUslDP3GTMIE/PfRsgeUQSaDADUgswC50A5sq6fObVrsrwht7QVHpwv7JwfOpbi+tToZGxc6oZ09f6xEVUygDLMMaeKTVGu6uh9ygTIBpCc8s0lB0E4jFKpQNFJB0tY8cjyhGfZ7eKU3vPYWJrSKf7vChMS8CvLEoL4KqJUxm3n7DrICyH2cxnJZud65zE+5UQCyhkM7ZKS3j09fJGAXy9w0JZk5cixvAXz/y1iEsfIedT4TSMmLShaLySynreGiC8b+BxmajEWErn+jb88SkrzloVbax3WwIYH305US44m8Ade8YcvJXb3C09+YCiULfrknfo+G5TyGHFXIR1nJzbGW8yLxfUgZrZw8o0D8dQ8Pur8+2//FYr93fWDSgEiK8biqjajA3FxMHMpR17e/iwvF4rbhxylkLkjfWck3aPhESiI9VREqO6cT3MLsSPwld8D4ls2cS0PgtWRb0SUuKWEtpLvNK08WvKvlGHSTS1lvsRbz6DhGfQMFhf+HRbjSX+usKtZq2/ZUVGLDVmrBDZpGf+qlQBLesrPiNUGfFutKn9WStiiA5najVx2n/wOBoZEN7zKfYKnqQ5I5Q/1bqPRGPF7rkv8RzFT1inwQC9IV9KlEuINkmd9Ft0x5sn7slM6xJNLb/3A+YIIuQek2daarv3pAdmva+/EzYYD0qon2KDlO0gOB0mUR/xPghrB/FcQoR2Qdjt985GhPkDn5/W67BgBubkWwtsBw5sq6aJjW5kB9bxNW/1uBlRjv3BOgke2QLT5IrsplNg4xmAs7ABmDJpMztL3gyELLunQmYUZCsKLPbXbR2cYjVNO83fJtM12q9XupwuOTWqMyZ0YvC9nHEvyNeptGyaNugVwywpYnNaT6+G/GnIWsUlo0isjVVorH3cFdtBO5lhuBIG09aGOZZi6V6edEc0wtVkkP3zW1H+UlUnrnN1SMpl4kgws2u13BhahlMxzQf3fSljNVnlBjblqEHUvxUi1uwUy3OzstVjfKsONjibDP7IgcgZoHhpdOxgrAXKI3Xi+MbFTK56VlvZ+u9uvrKCjgkVLkULt7nVpk8z/KsY0ltFKq7xVurnJzuIR3PRptb7D/6s1mtsmQuJiqgrxdfpjFpXAv1up9RY3IeRAdxONugI5vcVq2i6z11qis2cRnX2VCfrN02JmlDARJQSpWV9lj/TLphmArMm6o/oaktvM2ITUoqrXRfMpn1wHtQripva/pJx0NfPPr5QamAL5vk8M333suJ5LQtNwCuJ7SUGCD0iH7JJ9qwnrlvW6XIGanc5O/H+9ti/VaKW+1duKvil3QeMFTf3QkZpG+6HvzqI4aJBLbTd1Vx4/G/5Z8YUpKHmPNoYVIXGfSU/i8oZnmreH/pIOHfU1zmF7L6fXCapBvxQ4W8AHoqUUfD5LDgK8LQ+D9MJu4uWkNyyighi1DiFSOMWYaOQwUbFSJB+XXKIooHI5s45FbW3ijPWApJ2v/s2cOKJrVdlmKZ3rdDM+TlxGTpTOktY0rSmMEooql5TzYyYNj73USFgtz2pzqMRVLVtQ19gz1imvO5dm7v7GkVZ6JToDbNAfdlgj1y2pce06Cdh+AlteYn5IyFLsqG7o1HSjCcnbGhp6CDNxPKmS+8UCvInP2euU9DmdRO5sEtbOkbDnlnV9fUORAOSHRbJ0fC4pthJ6c3NJTm/2PqpEZaNzDi69H2kENd16MQhphcRVydJcKUpc+YzppccHcXpfD2iVbRpzmUZA023aNKXdsGhKxxr6aFhupvFZpOO9pRh5XxQVD0i91u7Yh/C7tMZi94zF7lkX28rPIZXFcYjawQvDn2W8mAj97cW5Tt2Yc616SGtlTqOfyihdkOtYah9Ney2uqMKhbGVvWKSrG0W6OLM0YNZ1mHw/vHRRqV5oswy/09SyIr7LbWZFjXqSFiXpQlLjs9QnOnXaaNpDFCXu0TeZ0/B1ZbFSqxnaHeGKOEcJH224rFMVLKwMFDsIbUu3SJz2aKtNN6mX5RSaM3vJD6qgPS8Z15n7xIaVsdb6zM3f0vr+UK6kl9O/dqWi1c6CXq+GXMwURQIUS6ZdSn9QBbm9RsLWzMKX182Ky6rZGKEMOCXJ0i60lnNv3dXuTbmiWtpctAqZ5TL8oSesognnUOsY4MR10dLutFNWNLomqeSN0NJJWNciGp2CXEu/N1qafN0Srs0KSbtKnKVfvz9qts0oQ728WbSfQRvDum6fkzba2GvW9yur0rOcFN4MD4RY1+1o5hiNIdvr0nIZuiXQUm6DZqdmo9ZgPzc10EShXsig9E5lFshg2GoPyyX93YL6tHIbcr3IzbZHWoaV2UivW2SQk4t0q3PFdbbYFa9qWi57TFkYQCujtbx6ZdzQWZUtptfBirhTb7YaXTt3GqO9fuv55tyxSKgahCfXzzJL7u6xER2st+RVpw3UW2Wljzc0N4nNtAWvTEXiS2qrZZRXurr6yFf+fcktTq3s1Mwrd+bG+s3cYKudwWg9pjY3Diu1y0sP2nZcj6em3uLFotJK37IY2ecqiJToiZgst1/8D7+Mvw1JcQAA"""
API_PAYLOAD = """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"""


def normalized_text(path: Path) -> str:
    return path.read_text().rstrip("\n")


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def decode_payload(value: str) -> str:
    return gzip.decompress(base64.b64decode(value)).decode().rstrip("\n")


def run(args: list[str]) -> None:
    print("+", " ".join(args), flush=True)
    result = subprocess.run(args, cwd=ROOT, check=False)
    if result.returncode != 0:
        raise SystemExit(result.returncode)


if ROOT.name != "instacomp-mobile":
    raise SystemExit(
        f"Run this from /Users/davidbakanas/instacomp-mobile; current directory is {ROOT}"
    )

for path in (SCREEN, API):
    if not path.exists():
        raise SystemExit(f"Missing required file: {path}")

new_screen = decode_payload(SCREEN_PAYLOAD)
new_api = decode_payload(API_PAYLOAD)

current_screen = normalized_text(SCREEN)
current_api = normalized_text(API)
current_screen_sha = sha256_text(current_screen)
current_api_sha = sha256_text(current_api)

if (
    current_screen_sha == PATCHED_SCREEN_SHA
    and current_api_sha == PATCHED_API_SHA
):
    print("The manual-camera patch is already installed.")
else:
    mismatches: list[str] = []
    if current_screen_sha not in {EXPECTED_SCREEN_SHA, PATCHED_SCREEN_SHA}:
        mismatches.append(
            f"src/app/index.tsx changed after the audit (sha={current_screen_sha})"
        )
    if current_api_sha not in {EXPECTED_API_SHA, PATCHED_API_SHA}:
        mismatches.append(
            f"src/lib/instacomp-api.ts changed after the audit (sha={current_api_sha})"
        )

    if mismatches:
        raise SystemExit(
            "Stopped without changing files because the audited source no longer matches:\n- "
            + "\n- ".join(mismatches)
        )

    backup_dir = (
        Path.home()
        / "Desktop"
        / f"instacomp-mobile-camera-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    )
    backup_dir.mkdir(parents=True, exist_ok=False)
    shutil.copy2(SCREEN, backup_dir / "index.tsx")
    shutil.copy2(API, backup_dir / "instacomp-api.ts")
    print(f"Backup saved to {backup_dir}")

    if current_screen_sha != PATCHED_SCREEN_SHA:
        SCREEN.write_text(new_screen + "\n")
    if current_api_sha != PATCHED_API_SHA:
        API.write_text(new_api + "\n")

screen_text = normalized_text(SCREEN)
api_text = normalized_text(API)

required_screen_markers = [
    "prepareInstaCompCardPhoto",
    "CANDIDATE IDENTITY — REVIEW REQUIRED",
    "consensus?.trustedForIdentity",
    "Keep all four card edges inside the frame",
    "onPress={() => void capturePhoto()}",
]
required_api_markers = [
    "centeredCardCrop",
    "detailImages",
    "`${side}-${position}-detail.jpg`",
    "SCAN_TIMEOUT_MS",
]

for marker in required_screen_markers:
    if marker not in screen_text:
        raise SystemExit(f"Screen patch verification failed: missing {marker}")
for marker in required_api_markers:
    if marker not in api_text:
        raise SystemExit(f"API patch verification failed: missing {marker}")

for forbidden in (
    "Accelerometer",
    "autoCaptureAvailable",
    "HOLD_STEADY_MS",
    "stableStartRef",
):
    if forbidden in screen_text:
        raise SystemExit(f"Automatic capture removal failed: still found {forbidden}")

if os.environ.get("INSTACOMP_PATCH_SKIP_TESTS") != "1":
    run(["npx", "tsc", "--noEmit"])
    run(
        [
            "npx",
            "eslint",
            "src/app/index.tsx",
            "src/lib/instacomp-api.ts",
        ]
    )

    export_dir = Path("/tmp/instacomp-mobile-camera-export")
    shutil.rmtree(export_dir, ignore_errors=True)
    run(
        [
            "npx",
            "expo",
            "export",
            "--platform",
            "web",
            "--clear",
            "--output-dir",
            str(export_dir),
        ]
    )
    shutil.rmtree(export_dir, ignore_errors=True)

print()
print("PATCH COMPLETE")
print("- automatic picture taking removed")
print("- manual front/back shutter retained")
print("- continuous focus, adjustable closer/wider framing, and light control added")
print("- visible 5:7 card guide added")
print("- captured photos are center-cropped to the guide before review/upload")
print("- four focused detail crops are sent to the existing scanner council")
print("- untrusted generic identities are labeled candidate-only")
print("- exact comps and pricing stay hidden until identity is trusted")
print()
print('Start with: npx expo start --clear')
