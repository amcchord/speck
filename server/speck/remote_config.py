"""Choose a remote experience without inferring headlessness from a missing window."""
import json

from speck.config import unseal


def remote_options(device):
    telemetry = device['telemetry']
    if isinstance(telemetry, str):
        telemetry = json.loads(telemetry)
    caps = telemetry.get('capabilities')
    if not isinstance(caps, dict):
        caps = {}
    shell = device['platform'] in ('linux', 'windows') and caps.get('web_shell') is True
    config = json.loads(unseal(device['remote_secret'])) if device.get('remote_secret') else None
    desktop = caps.get('desktop')
    configured = (config or {}).get('protocol')
    prefer_shell = not config or (device['platform'] == 'linux' and (desktop == 'headless' or (desktop != 'available' and configured == 'ssh')))
    protocol = 'shell' if shell and prefer_shell else configured
    return config, {
        'remote_protocol': protocol,
        'remote_configured': bool(protocol),
        'remote_shell_available': shell,
        'configured_remote_protocol': (config or {}).get('protocol'),
    }
