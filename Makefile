# Meridian: common tasks
.PHONY: run debug test deb demo apparmor apparmor-remove clean

run:
	./bin/meridian-calendar

debug:
	MERIDIAN_DEBUG=1 ./bin/meridian-calendar --debug

test:
	node tests/logic.test.js

deb:
	./packaging/build-deb.sh

demo:
	MERIDIAN_DATA_DIR=/tmp/meridian-demo python3 tools/seed_demo.py
	MERIDIAN_DATA_DIR=/tmp/meridian-demo ./bin/meridian-calendar

# Ubuntu 24.04: let WebKit sandbox itself when running from this folder.
LAUNCHER := $(realpath bin/meridian-calendar)
apparmor:
	@printf 'abi <abi/4.0>,\ninclude <tunables/global>\n\nprofile meridian-calendar-dev "%s" flags=(unconfined) {\n  userns,\n}\n' "$(LAUNCHER)" \
	  | sudo tee /etc/apparmor.d/meridian-calendar-dev >/dev/null
	sudo apparmor_parser -r /etc/apparmor.d/meridian-calendar-dev
	@echo "AppArmor profile installed for $(LAUNCHER)"

apparmor-remove:
	-sudo apparmor_parser -R /etc/apparmor.d/meridian-calendar-dev
	sudo rm -f /etc/apparmor.d/meridian-calendar-dev

clean:
	rm -rf build dist meridian/__pycache__
