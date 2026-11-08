from __future__ import annotations

import os

# This patch is opt-in and only enabled by run-lora-training-safe.sh.
if os.environ.get("INSTACOMP_MLX_SAFE_RESUME") == "1":
    from mlx.utils import tree_flatten
    from mlx_vlm.trainer import utils as trainer_utils

    _upstream_apply_lora_layers = trainer_utils.apply_lora_layers

    def _instacomp_safe_apply_lora_layers(model, adapter_path):
        # MLX-VLM 0.6.8 freezes the base on fresh LoRA setup but omits this
        # freeze in the --adapter-path branch. Freeze first, then let the
        # upstream loader recreate the LoRA modules and load their weights.
        trainer_utils.freeze_model(model)
        resumed = _upstream_apply_lora_layers(model, adapter_path)

        trainable = tree_flatten(resumed.trainable_parameters())
        unexpected = [
            name
            for name, _value in trainable
            if not (name.endswith("lora_a") or name.endswith("lora_b"))
        ]
        if unexpected:
            raise RuntimeError(
                "InstaComp blocked unsafe MLX-VLM resume because non-LoRA base "
                "parameters are trainable: " + ", ".join(unexpected[:10])
            )
        if not trainable:
            raise RuntimeError(
                "InstaComp blocked unsafe MLX-VLM resume because no trainable "
                "LoRA tensors remained after loading the adapter."
            )
        return resumed

    trainer_utils.apply_lora_layers = _instacomp_safe_apply_lora_layers
