"""Send the owner's explicitly authorized pilot handoff using the app mailbox."""
import argparse
import base64
import io
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RECIPIENTS = {'jonesmadunga@gmail.com', 'smngoma22@gmail.com'}
EVENT = 'pilot-20261013-ios42-android5'
MAIL = r'''
import base64,json,os,smtplib,ssl,sys
from email.message import EmailMessage
from email.utils import formatdate
p=json.load(sys.stdin)
assert p['recipient'] in {'jonesmadunga@gmail.com','smngoma22@gmail.com'}
assert os.environ['SMTP_FROM']=='noreply@papzii.co.za'
assert os.environ['SMTP_HOST']=='mail.papzii.co.za'
assert os.environ.get('SMTP_SSL','').lower()=='true'
message=EmailMessage()
message['From']=os.environ['SMTP_FROM']; message['To']=p['recipient']
message['Subject']='Papzii live pilot: install iOS 42 / Android 5, workflow guide and screenshots'
message['Date']=formatdate(localtime=False)
message['Message-ID']='<'+p['identity']+'@papzii.co.za>'
message.set_content(p['body'])
message.add_attachment(base64.b64decode(p['attachment']),maintype='application',subtype='zip',filename='Papzii-pilot-guide-and-QA-screenshots.zip')
with smtplib.SMTP_SSL(os.environ['SMTP_HOST'],int(os.environ['SMTP_PORT']),timeout=30,context=ssl.create_default_context()) as smtp:
 smtp.login(os.environ['SMTP_USER'],os.environ['SMTP_PASSWORD'])
 refused=smtp.send_message(message)
 if refused: raise RuntimeError('Recipient refused')
print(json.dumps({'smtpAccepted':True,'deliveryToInboxVerified':False}))
'''
REMOTE = r'''
import base64,fcntl,hashlib,json,os,subprocess,sys
from pathlib import Path
p=json.load(sys.stdin)
assert p['event']=='pilot-20261013-ios42-android5'
assert set(p['recipients'])=={'jonesmadunga@gmail.com','smngoma22@gmail.com'}
root=Path('/var/lib/papzii/pilot-handoff'); root.mkdir(mode=0o700,parents=True,exist_ok=True)
accepted=already=0
with (root/'lock').open('a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 for recipient in p['recipients']:
  identity=hashlib.sha256((p['event']+':'+recipient).encode()).hexdigest()
  receipt=root/(identity+'.json')
  if receipt.exists():
   assert json.loads(receipt.read_text())['state']=='smtp-accepted','Inspect ambiguous prior delivery before retrying'
   already+=1; continue
  receipt.write_text(json.dumps({'state':'attempting'}))
  data={'recipient':recipient,'identity':identity,'body':p['body'],'attachment':p['attachment']}
  code=base64.b64decode(p['mailCode']).decode()
  child=subprocess.run(['docker','exec','-i','papzii-api','python','-c',code],input=json.dumps(data),text=True,capture_output=True,timeout=90)
  assert child.returncode==0,'Inspect protected delivery receipt before retrying'
  result=json.loads(child.stdout); assert result['smtpAccepted']
  receipt.write_text(json.dumps({'state':'smtp-accepted','deliveryToInboxVerified':False}))
  accepted+=1
print(json.dumps({'recipientCount':len(p['recipients']),'smtpAccepted':accepted,'alreadyAccepted':already,'deliveryToInboxVerified':False}))
'''


def package():
    guide = (ROOT / 'docs/PILOT_HANDOFF_20261013.md').read_text()
    images = []
    for directory in ('test-results', 'docs/output/pilot-screens-20261013'):
        images.extend(sorted((ROOT / directory).rglob('*.png')))
    if not images:
        raise ValueError('Reviewed QA screenshots are required')
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('README-QA-NOT-NATIVE.txt', guide)
        for picture in images:
            archive.write(picture, 'QA-screenshots/' + picture.relative_to(ROOT).as_posix())
    data = buffer.getvalue()
    if len(data) > 10 * 1024 * 1024:
        raise ValueError('Handoff exceeds attachment size limit')
    destination = ROOT / 'docs/output/Papzii-pilot-guide-and-QA-screenshots.zip'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    return guide, data, len(images)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--send', action='store_true')
    args = parser.parse_args()
    guide, data, count = package()
    result = {'screenshots': count, 'attachmentBytes': len(data), 'sent': False}
    if args.send:
        payload = {'event': EVENT, 'recipients': sorted(RECIPIENTS), 'body':
                   'Hi Jones and Sam,\n\nThe updated restricted pilot is available: iOS build 42 and Android version 5. '
                   'Please use your own accounts and follow the guide below. The ZIP includes browser QA screenshots, not native-device proof.\n\n' + guide,
                   'attachment': base64.b64encode(data).decode(), 'mailCode': base64.b64encode(MAIL.encode()).decode()}
        code = 'exec(__import__("base64").b64decode("' + base64.b64encode(REMOTE.encode()).decode() + '"))'
        child = subprocess.run(['ssh', '-i', 'C:/Users/27790/.ssh/madabukela_oci', '-o', 'BatchMode=yes',
                                '-o', 'StrictHostKeyChecking=yes', 'opc@129.151.188.15',
                                'sudo', '-n', 'python3', '-c', "'" + code + "'"],
                               input=json.dumps(payload), capture_output=True, text=True, timeout=210)
        if child.returncode:
            raise SystemExit('Delivery unconfirmed. Inspect the protected server receipt before retrying; no duplicate send attempted.')
        result.update(json.loads(child.stdout), sent=True)
    receipt = 'pilot-handoff-delivery-20261013.json' if args.send else 'pilot-handoff-package-20261013.json'
    (ROOT / 'docs' / receipt).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
