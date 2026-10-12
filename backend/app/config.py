"""Runtime configuration; never log or expose the complete settings object."""

from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT / ".env",
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
        hide_input_in_errors=True,
    )

    # Any OpenAI-compatible provider. Disabled by default: the offline planner answers instead.
    llm_enabled: bool = False
    ai_base_url: str = ""
    ai_api_key: SecretStr = Field(default=SecretStr(""), repr=False)
    ai_model: str = ""
    ai_vision_model: str = ""
    llm_hourly_call_cap: int = Field(default=60, ge=1, le=5000)
    llm_max_output_tokens: int = Field(default=1200, ge=1, le=4096)
    llm_timeout_seconds: float = Field(default=45.0, ge=5, le=180)

    admin_token: SecretStr = Field(default=SecretStr(""), repr=False)
    session_ttl_hours: int = Field(default=168, ge=1, le=720)
    ip_hash_salt: SecretStr = Field(default=SecretStr(""), repr=False)
    public_base_url: str = "http://localhost:8000"
    # Passkeys are bound to this host name; it must match the address people open.
    passkey_rp_id: str = "localhost"
    data_dir: Path = ROOT / "data"
    static_dir: Path = ROOT / "frontend" / "dist"

    # The demo panel can move a customer's clock and reset their bank.
    demo_tools_enabled: bool = True
    scheduler_interval_seconds: int = Field(default=15, ge=1, le=300)
    sandbox_enabled: bool = True
