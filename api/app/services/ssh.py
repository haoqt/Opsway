"""
SSH Key Service — Generate RSA key pairs for Deploy Keys
"""
from cryptography.hazmat.primitives import serialization as crypto_serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.backends import default_backend as crypto_default_backend

def generate_ssh_key_pair(comment: str = "opsway-deploy-key"):
    """
    Generate a 4096-bit RSA key pair.
    Returns (public_key_text, private_key_text).
    """
    key = rsa.generate_private_key(
        backend=crypto_default_backend(),
        public_exponent=65537,
        key_size=4096
    )

    private_key = key.private_bytes(
        crypto_serialization.Encoding.PEM,
        crypto_serialization.PrivateFormat.PKCS8,
        crypto_serialization.NoEncryption()
    ).decode("utf-8")

    public_key = key.public_key().public_bytes(
        crypto_serialization.Encoding.OpenSSH,
        crypto_serialization.PublicFormat.OpenSSH
    ).decode("utf-8")

    return f"{public_key} {comment}", private_key
