import os

file_path = 'c:/Users/27790/papzi_ver_10/mobilable-project-3df98c33/ts_errors.txt'
if os.path.exists(file_path):
    with open(file_path, 'rb') as f:
        content = f.read()
        # Try different encodings
        for encoding in ['utf-16', 'utf-16le', 'utf-8']:
            try:
                text = content.decode(encoding)
                print(f"--- Decoded with {encoding} ---")
                print(text)
                break
            except Exception:
                continue
else:
    print("File not found")
