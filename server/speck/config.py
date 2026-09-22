import base64
import hashlib
import os
from pathlib import Path

from cryptography.fernet import Fernet


def data_dir():
    return Path(os.environ.get('SPECK_DATA_DIR', 'output/data'))


def origin():
    return os.environ.get('SPECK_ORIGIN', 'http://localhost:8088').rstrip('/')


def cipher():
    key = os.environ.get('SPECK_ENCRYPTION_KEY', '')
    if len(key) < 32:
        raise RuntimeError('SPECK_ENCRYPTION_KEY must contain at least 32 random characters')
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(key.encode()).digest()))


def seal(text):
    return cipher().encrypt(text.encode()).decode()


def unseal(text):
    return cipher().decrypt(text.encode()).decode()
