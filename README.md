# RG_HMI
Idk this is yet another hobby project that got out of hand.

## What does it do?
- Keep track of machine pallets in a material handling workcell
- Check their status, position, name, etc.
- Instruct the robot based on what they do (e.g. move to machine)
- Probably more but it's too complicated for me to comprehend rn

## Nice to know
KAREL Currently uses both internal vars and the numerical registry.\
Listed below are the numerical registries it uses and for what
- R[110]: number of pending entries to import, from 1 to 3
- R[111..113]: operation code for queue slots 1 to 3 (1 = machine, 2 = rack)
- R[114..116]: pallet target for queue slots 1 to 3
- R[117]: multitsk state (0 = idle, 1 = running, 2 = complete, negative = KAREL error)
- R[1]: active pallet target used by the motion programs
- R[118]: latest KAREL GET_VAR/SET_VAR/CALL_PROG status (0 = success)
- R[119]: current KAREL queue length (0 to 3)
- R[120..122]: current KAREL queue operation codes for slots 1 to 3
- R[123..125]: current KAREL queue pallet targets for slots 1 to 3

## How to run
Start `multitsk` once as a controller task while the robot is idle.\
Once that is running, start the server.py and access the webpage to control things.

The HMI submitsone operation at a time by writing the import slot registers first and R[110] last
as the commit signal. KAREL owns the FIFO queue and publishes its current contents
through R[119..125]. Do not start the individual movement programs from the HMI.\

You might see Roboguide doesn't see the simulation as "Running" or "Busy" but this is normal.
